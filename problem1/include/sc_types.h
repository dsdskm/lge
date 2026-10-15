#ifndef SC_TYPES_H
#define SC_TYPES_H
#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <sys/types.h>
enum {
    SC_OK = 0, SC_EINVAL = -1, SC_EBUSY = -2, SC_ERANGE = -3,
    SC_EIO = -4, SC_ENOMEM = -5, SC_ENOENT = -6, SC_EPROTO = -7, SC_EPERM = -8
};
#endif
