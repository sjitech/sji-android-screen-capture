#include "libEGL.h"

int eglGetError() {}
void* eglGetDisplay(int display_id) {}
bool eglInitialize (void* dpy, int *major, int *minor) {}
void* eglCreateContext(void* dpy, void* config, void* unused1, void* unused2) {}
void* eglCreateSyncKHR(void* dpy, int type, void*attrib_list) {}
int eglClientWaitSyncKHR(void* dpy, void* sync, int flags, uint64_t timeout) {}
bool eglSignalSyncKHR(void* dpy, void* sync, int mode) {}
