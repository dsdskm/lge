#ifndef CTL_H
#define CTL_H
#include "sc_types.h"
#include "store.h"

typedef void (*ctl_evt_cb_t)(int state, void *user);

typedef struct { int lo, hi; } ctl_range_t;

typedef struct {
    int          rate;
    ctl_range_t  bounds;       /* nested */
} ctl_cfg_t;

typedef struct {
    int faults;
    int idle;
} ctl_counters_t;

typedef struct {
    int             state;
    int             pending;
    ctl_cfg_t       cfg;        /* struct-of-struct */
    ctl_counters_t  cnt;        /* struct-of-struct */
    store_t        *store;
    ctl_evt_cb_t    cb;
    void           *cb_user;
} ctl_t;

int  ctl_init(ctl_t *c, store_t *s);
int  ctl_on_event(ctl_t *c, ctl_evt_cb_t cb, void *user);
int  ctl_configure(ctl_t *c, int rate);
int  ctl_step(ctl_t *c, int ev);
void ctl_run(ctl_t *c);
#endif
