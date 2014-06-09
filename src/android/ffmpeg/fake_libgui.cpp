#include <unistd.h>
#include <sys/types.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>

#define LOG(...) fprintf(stderr, __VA_ARGS__)

namespace android {

template <typename T> class sp {
public:
    T* m_ptr;
};

class IBinder;

class ScreenshotClient
{
    /*
    sp<IMemoryHeap> mHeap;
    uint32_t mWidth;
    uint32_t mHeight;
    PixelFormat mFormat;
    */
    char data[64];
public:
    ScreenshotClient();

    // frees the previous screenshot and capture a new one
    int32_t update();
    // frees the previous screenshot and capture a new one
    int32_t update(const sp<IBinder>& display);
    // pixels are valid until this object is freed or
    // release() or update() is called
    void const* getPixels() const;

    uint32_t getWidth() const;
    uint32_t getHeight() const;
    int32_t getFormat() const;
    // size of allocated memory in bytes
    size_t getSize() const;
};

ScreenshotClient::ScreenshotClient() {
    LOG("ScreenshotClient::ScreenshotClient()\n");
}

// frees the previous screenshot and capture a new one
int32_t ScreenshotClient::update() {
    LOG("ScreenshotClient::update()\n");
    return 1;
}
// frees the previous screenshot and capture a new one
int32_t ScreenshotClient::update(const sp<IBinder>& display) {
    LOG("ScreenshotClient::update(const sp<IBinder>& display)\n");
    return 1;
}

// pixels are valid until this object is freed or
// release() or update() is called
void const* ScreenshotClient::getPixels() const {
    LOG("ScreenshotClient::getPixels()\n");
    return NULL;
}

uint32_t ScreenshotClient::getWidth() const {
    LOG("ScreenshotClient::getWidth()\n");
    return 0;
}
uint32_t ScreenshotClient::getHeight() const {
    LOG("ScreenshotClient::getHeight()\n");
    return 0;
}
int32_t ScreenshotClient::getFormat() const {
    LOG("ScreenshotClient::getFormat()\n");
    return 0;
}
// size of allocated memory in bytes
size_t ScreenshotClient::getSize() const {
    LOG("ScreenshotClient::getSize()\n");
    return 0;
}

class SurfaceComposerClient
{
public:
    //! Get the token for the existing default displays.
    //! Possible values for id are eDisplayIdMain and eDisplayIdHdmi.
    static sp<IBinder> getBuiltInDisplay(int32_t id);
};

sp<IBinder> SurfaceComposerClient::getBuiltInDisplay(int32_t id) {
    LOG("SurfaceComposerClient::getBuiltInDisplay(int32_t id)\n");
    sp<IBinder> p;
    p.m_ptr = NULL;
    return p;
}

}