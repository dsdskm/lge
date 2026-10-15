#ifndef STORE_H
#define STORE_H
#include "sc_types.h"

/* Opaque handle: internals live in store.c. Callers obtain one via
 * store_new() and dispose of it with store_free(); the struct layout is
 * not visible across translation units. */
typedef struct store_s store_t;

store_t *store_new(void);
void     store_free(store_t *s);

void store_reset_stats(void);
int  store_load (store_t *s, const char *path);
int  store_save (const store_t *s, const char *path);
int  store_grow (store_t *s, size_t extra);
int  store_append(store_t *s, const uint8_t *rec, size_t n);
int  store_get  (const store_t *s, size_t idx, uint8_t *out, size_t *out_n);
void store_verify(const store_t *s);
int  store_close(store_t *s);
#endif
