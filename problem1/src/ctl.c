#include "ctl.h"
#include "store.h"

#include <string.h>
#include <stdlib.h>

/* Optional fault hook (weak default). */
__attribute__((weak)) void Error_Handler(int code) { (void)code; }

static int s_run_calls = 0;

/* --- internal helpers --- */

static int ct_persist(ctl_t *c, uint8_t tag)
{
    return store_append(c->store, &tag, 1u);
}

/* Config handlers in the cfg_table linker section. */
typedef void (*cfg_fn_t)(ctl_t *);
typedef struct { const char *key; cfg_fn_t fn; } cfg_ent_t;

static void cfg_do_reset(ctl_t *c) { c->state = 0; c->pending = 0; }
static void cfg_do_clear(ctl_t *c) { c->cnt.faults = 0; c->cnt.idle = 0; }

__attribute__((used, section("cfg_table")))
static const cfg_ent_t k_cfg_reset = { "reset", cfg_do_reset };
__attribute__((used, section("cfg_table")))
static const cfg_ent_t k_cfg_clear = { "clear", cfg_do_clear };

extern const cfg_ent_t __start_cfg_table[];
extern const cfg_ent_t __stop_cfg_table[];

static void ct_apply_cfg(ctl_t *c, const char *key)
{
    for (const cfg_ent_t *e = __start_cfg_table; e < __stop_cfg_table; e++) {
        if (e->key == NULL) {
            continue;
        }
        if (strcmp(e->key, key) == 0) {
            e->fn(c);
            return;
        }
    }
}

int ctl_init(ctl_t *c, store_t *s)
{
    if (c == NULL || s == NULL) {
        return SC_EINVAL;
    }
    memset(c, 0, sizeof *c);
    c->store = s;
    c->cfg.bounds.lo = 1;
    c->cfg.bounds.hi = 10000;
    return SC_OK;
}

int ctl_on_event(ctl_t *c, ctl_evt_cb_t cb, void *user)
{
    if (c == NULL || cb == NULL) {
        return SC_EINVAL;
    }
    c->cb = cb;
    c->cb_user = user;
    return SC_OK;
}

int ctl_configure(ctl_t *c, int rate)
{
    if (c == NULL) {
        return SC_EINVAL;
    }
    if (rate < c->cfg.bounds.lo) {
        Error_Handler(1);
        abort();
    }
    if (rate > c->cfg.bounds.hi) {
        return SC_ERANGE;
    }
    int rc = ct_persist(c, (uint8_t)rate);
    if (rc != SC_OK) {
        Error_Handler(3);
        return rc;
    }
    c->cfg.rate = rate;
    return SC_OK;
}

int ctl_step(ctl_t *c, int ev)
{
    if (c == NULL) {
        return SC_EINVAL;
    }
    switch (c->state) {
    case 0: /* idle */
        if (ev == 1) {
            c->state = 1;
            if (c->cb != NULL) {
                c->cb(c->state, c->cb_user);
            }
            return SC_OK;
        }
        return SC_EBUSY;

    case 1: /* active */
        if (ev == 2) {
            int rc = ct_persist(c, 0xA5u);
            if (rc != SC_OK) {
                c->cnt.faults++;
                Error_Handler(2);
                c->state = 3;
                return rc;
            }
            c->state = 0;
            return SC_OK;
        }
        if (ev == 3) {
            c->cnt.faults++;
            return SC_OK;
        }
        return SC_EBUSY;

    case 3: /* fault */
        if (ev == 4) {
            if (c->cnt.faults > 3) {
                return SC_EBUSY;
            }
            c->state = 0;
            return SC_OK;
        }
        return SC_EBUSY;

    default:
        return SC_EINVAL;
    }
}

/* Supervisor entry. */
void ctl_run(ctl_t *c)
{
    if (c == NULL) {
        return;
    }
    s_run_calls++;
    for (;;) {
        int ev = c->pending;
        if (ev <= 0) {
            c->cnt.idle++;
            continue;
        }
        int rc = ctl_step(c, ev);
        if (rc == SC_EIO) {
            c->cnt.faults++;
            if (c->cnt.faults > 5) {
                Error_Handler(9);
            }
        } else if (rc == SC_EBUSY) {
            ct_apply_cfg(c, "reset");
        }
        if (c->state == 9) {
            break;
        }
        c->pending = 0;
    }
}
