#include "libcutils.h"

int32_t android_atomic_inc(volatile int32_t* addr) {}
int32_t android_atomic_dec(volatile int32_t* addr) {}
int android_atomic_release_cas(int32_t oldvalue, int32_t newvalue, volatile int32_t* addr) {}
int property_get(const char *key, char *value, const char *default_value) {}
