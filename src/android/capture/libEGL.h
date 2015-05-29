#if !defined(HFILE_libEGL) && ANDROID_VER>=400
#define HFILE_libEGL

#include <sys/types.h>

extern "C" {
    int eglGetError();
    void* eglGetDisplay(int display_id);
    bool eglInitialize (void* dpy, int *major, int *minor);
    void* eglCreateContext(void* dpy, void* config, void* unused1, void* unused2);

    #define EGL_SYNC_FENCE_KHR                  0x30F9
    #define EGL_SYNC_NATIVE_FENCE_ANDROID		0x3144
    void* eglCreateSyncKHR(void* dpy, int type, void*attrib_list);

    #define EGL_SYNC_FLUSH_COMMANDS_BIT_KHR 0x0001
    int eglClientWaitSyncKHR(void* dpy, void* sync, int flags, uint64_t timeout);

    bool eglSignalSyncKHR(void* dpy, void* sync, int mode);
}

#endif //end of lib