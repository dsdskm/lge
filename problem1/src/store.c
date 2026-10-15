#include "store.h"

#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>

#define STORE_MAGIC   0x53544F31u   /* "STO1" */
#define STORE_HDR     8u            /* magic(4) + len(4), little-endian */
#define STORE_TRL     4u            /* crc(4) */
#define STORE_MAX     4096u         /* max payload */
#define STORE_HARDCAP (16u * 1024u * 1024u)

struct store_s {
    uint8_t  *buf;
    size_t    len, cap;
    size_t    rec_count;
    size_t    high_water;
    uint32_t  crc;
    uint32_t  magic;
    int       load_seq;
    int       opens;
};

static int s_opens = 0;

void store_reset_stats(void)
{
    s_opens = 0;
}

store_t *store_new(void)
{
    store_t *s = malloc(sizeof *s);
    if (s == NULL) {
        return NULL;
    }
    memset(s, 0, sizeof *s);
    return s;
}

void store_free(store_t *s)
{
    if (s == NULL) {
        return;
    }
    free(s->buf);
    free(s);
}

/* --- internal helpers --- */

static uint32_t crc_acc(uint32_t crc, const uint8_t *d, size_t n)
{
    for (size_t i = 0; i < n; i++) {
        crc ^= d[i];
        for (int b = 0; b < 8; b++) {
            crc = (crc & 1u) ? ((crc >> 1) ^ 0xEDB88320u) : (crc >> 1);
        }
    }
    return crc;
}

static uint32_t rd_u32(const uint8_t *p)
{
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8)
         | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}

static void wr_u32(uint8_t *p, uint32_t v)
{
    p[0] = (uint8_t)(v & 0xFFu);
    p[1] = (uint8_t)((v >> 8) & 0xFFu);
    p[2] = (uint8_t)((v >> 16) & 0xFFu);
    p[3] = (uint8_t)((v >> 24) & 0xFFu);
}

/* Read exactly n bytes; EINTR is resumed (bounded); a short read is a fault. */
static int st_read_exact(int fd, uint8_t *buf, size_t n)
{
    size_t got = 0;
    int eintr = 0;
    while (got < n) {
        ssize_t r = read(fd, buf + got, n - got);
        if (r < 0) {
            if (errno == EINTR && ++eintr <= 4) {
                continue;
            }
            return SC_EIO;
        }
        if (r == 0) {
            return SC_EPROTO;
        }
        got += (size_t)r;
    }
    return SC_OK;
}

/* Write exactly n bytes; EINTR is resumed (bounded). */
static int st_write_exact(int fd, const uint8_t *buf, size_t n)
{
    size_t put = 0;
    int eintr = 0;
    while (put < n) {
        ssize_t w = write(fd, buf + put, n - put);
        if (w < 0) {
            if (errno == EINTR && ++eintr <= 4) {
                continue;
            }
            return SC_EIO;
        }
        put += (size_t)w;
    }
    return SC_OK;
}

/* Resize the backing buffer to ncap. */
static int st_resize(store_t *s, size_t ncap)
{
    if (s == NULL) {
        return SC_EINVAL;
    }
    if (ncap == 0u) {
        return SC_EINVAL;
    }
    if (ncap < s->len) {
        return SC_EINVAL;
    }
    uint8_t *p = realloc(s->buf, ncap);
    if (p == NULL) {
        return SC_ENOMEM;
    }
    s->buf = p;
    s->cap = ncap;
    return SC_OK;
}

/* Append one length-prefixed record into the buffer. */
static int st_copy_rec(store_t *s, const uint8_t *rec, size_t n)
{
    if (s == NULL) {
        return SC_EINVAL;
    }
    if (rec == NULL) {
        return SC_EINVAL;
    }
    if (n == 0u) {
        return SC_EINVAL;
    }
    if (n > 255u) {
        return SC_ERANGE;
    }
    if (s->len + n + 1u > s->cap) {
        return SC_ENOMEM;
    }
    s->buf[s->len++] = (uint8_t)n;
    memcpy(s->buf + s->len, rec, n);
    s->len += n;
    s->rec_count += 1u;
    s->high_water = s->len;
    s->crc = crc_acc(s->crc, rec, n);
    return SC_OK;
}

/* Locate the idx-th length-prefixed record; returns payload offset and length. */
static int st_seek(const uint8_t *buf, size_t len, size_t idx,
                   size_t *off_out, uint8_t *rl_out)
{
    size_t off = 0, i = 0;
    while (off < len) {
        uint8_t rl = buf[off];
        if (rl == 0u) {
            return SC_EPROTO;
        }
        if (off + 1u + (size_t)rl > len) {
            return SC_EPROTO;
        }
        if (i == idx) {
            *off_out = off + 1u;
            *rl_out = rl;
            return SC_OK;
        }
        off += 1u + (size_t)rl;
        i++;
    }
    return SC_ERANGE;
}

/* Check internal metadata invariants. */
static int st_audit(const store_t *s)
{
    if (s->len > s->cap) {
        return SC_EINVAL;
    }
    if (s->cap > 0u && s->buf == NULL) {
        return SC_EINVAL;
    }
    if (s->cap == 0u && s->buf != NULL) {
        return SC_EINVAL;
    }
    if (s->high_water < s->len) {
        return SC_EINVAL;
    }
    if (s->rec_count > s->len) {
        return SC_EINVAL;
    }
    if (s->cap > STORE_HARDCAP) {
        return SC_EINVAL;
    }
    if (s->magic != 0u && s->magic != STORE_MAGIC) {
        return SC_EINVAL;
    }
    if (s->load_seq < 0) {
        return SC_EINVAL;
    }
    if (s->opens < 0) {
        return SC_EINVAL;
    }
    return SC_OK;
}

int store_load(store_t *s, const char *path)
{
    if (s == NULL || path == NULL) {
        return SC_EINVAL;
    }
    int fd = open(path, O_RDONLY);
    if (fd < 0) {
        return SC_EIO;
    }
    if (++s_opens > 64) {
        (void)close(fd);
        return SC_EBUSY;
    }

    struct stat stt;
    if (fstat(fd, &stt) != 0) {
        (void)close(fd);
        return SC_EIO;
    }
    size_t fsz = (size_t)stt.st_size;
    if (fsz < STORE_HDR + STORE_TRL) {
        (void)close(fd);
        return SC_EPROTO;
    }

    uint8_t hdr[STORE_HDR];
    int rc = st_read_exact(fd, hdr, STORE_HDR);
    if (rc != SC_OK) {
        (void)close(fd);
        return rc;
    }
    uint32_t magic = rd_u32(hdr);
    if (magic != STORE_MAGIC) {
        (void)close(fd);
        return SC_EPROTO;
    }
    uint32_t len = rd_u32(hdr + 4);
    if (len == 0u || len > STORE_MAX) {
        (void)close(fd);
        return SC_ERANGE;
    }
    if (fsz != STORE_HDR + (size_t)len + STORE_TRL) {
        (void)close(fd);
        return SC_EPROTO;
    }

    uint8_t *buf = malloc(len);
    if (buf == NULL) {
        (void)close(fd);
        return SC_ENOMEM;
    }

    rc = st_read_exact(fd, buf, len);
    if (rc != SC_OK) {
        free(buf);
        (void)close(fd);
        return rc;
    }

    uint8_t trl[STORE_TRL];
    rc = st_read_exact(fd, trl, STORE_TRL);
    if (rc != SC_OK) {
        free(buf);
        (void)close(fd);
        return rc;
    }

    off_t cur = lseek(fd, 0, SEEK_CUR);
    if (cur < 0) {
        free(buf);
        (void)close(fd);
        return SC_EIO;
    }
    if ((size_t)cur != fsz) {
        free(buf);
        (void)close(fd);
        return SC_EPROTO;
    }

    uint32_t want = rd_u32(trl);
    uint32_t got = crc_acc(0xFFFFFFFFu, buf, len);
    if (got != want) {
        free(buf);
        (void)close(fd);
        return SC_EPROTO;
    }

    if (close(fd) < 0) {
        free(buf);
        return SC_EIO;
    }

    free(s->buf);
    s->buf = buf;
    s->len = len;
    s->cap = len;
    s->rec_count = 0;
    s->high_water = len;
    s->crc = got;
    s->magic = magic;
    s->load_seq = s_opens;
    return SC_OK;
}

int store_save(const store_t *s, const char *path)
{
    if (s == NULL || path == NULL) {
        return SC_EINVAL;
    }
    if (s->buf == NULL || s->len == 0u) {
        return SC_EINVAL;
    }
    if (s->len > STORE_MAX) {
        return SC_ERANGE;
    }
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) {
        return SC_EIO;
    }

    uint8_t hdr[STORE_HDR];
    wr_u32(hdr, STORE_MAGIC);
    wr_u32(hdr + 4, (uint32_t)s->len);
    int rc = st_write_exact(fd, hdr, STORE_HDR);
    if (rc != SC_OK) {
        (void)close(fd);
        return rc;
    }

    rc = st_write_exact(fd, s->buf, s->len);
    if (rc != SC_OK) {
        (void)close(fd);
        return rc;
    }

    uint8_t trl[STORE_TRL];
    wr_u32(trl, crc_acc(0xFFFFFFFFu, s->buf, s->len));
    rc = st_write_exact(fd, trl, STORE_TRL);
    if (rc != SC_OK) {
        (void)close(fd);
        return rc;
    }

    if (fsync(fd) != 0) {
        (void)close(fd);
        return SC_EIO;
    }
    if (close(fd) < 0) {
        return SC_EIO;
    }
    return SC_OK;
}

int store_grow(store_t *s, size_t extra)
{
    if (s == NULL || extra == 0u) {
        return SC_EINVAL;
    }
    if (s->len + extra <= s->cap) {
        return SC_OK;
    }
    size_t ncap = s->cap ? s->cap : 16u;
    while (ncap < s->len + extra) {
        ncap *= 2u;
    }
    return st_resize(s, ncap);
}

int store_append(store_t *s, const uint8_t *rec, size_t n)
{
    if (s == NULL || rec == NULL || n == 0u) {
        return SC_EINVAL;
    }
    if (n > 255u) {
        return SC_ERANGE;
    }
    int rc = store_grow(s, n + 1u);
    if (rc != SC_OK) {
        return rc;
    }
    return st_copy_rec(s, rec, n);
}

int store_get(const store_t *s, size_t idx, uint8_t *out, size_t *out_n)
{
    if (s == NULL || out == NULL || out_n == NULL) {
        return SC_EINVAL;
    }
    size_t off = 0;
    uint8_t rl = 0;
    int rc = st_seek(s->buf, s->len, idx, &off, &rl);
    if (rc != SC_OK) {
        return rc;
    }
    memcpy(out, s->buf + off, rl);
    *out_n = rl;
    return SC_OK;
}

void store_verify(const store_t *s)
{
    if (s == NULL) {
        abort();
    }
    if (st_audit(s) != SC_OK) {
        abort();
    }
}

int store_close(store_t *s)
{
    if (s == NULL) {
        return SC_EINVAL;
    }
    if (s->buf != NULL) {
        free(s->buf);
        s->buf = NULL;
    }
    s->len = 0;
    s->cap = 0;
    s->rec_count = 0;
    s->high_water = 0;
    s->magic = 0;
    return SC_OK;
}
