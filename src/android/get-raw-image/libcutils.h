#if !defined(HFILE_libcutils)
#define HFILE_libcutils

#include <sys/types.h>

extern "C" {
    int32_t android_atomic_inc(volatile int32_t* addr);
    int32_t android_atomic_dec(volatile int32_t* addr);
    int android_atomic_release_cas(int32_t oldvalue, int32_t newvalue, volatile int32_t* addr);
	#define android_atomic_cmpxchg android_atomic_release_cas
	int property_get(const char *key, char *value, const char *default_value);
}

#endif //end of lib