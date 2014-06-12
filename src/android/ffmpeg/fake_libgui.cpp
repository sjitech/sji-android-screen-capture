#include <unistd.h>
#include <sys/types.h>

namespace android {

template <typename T> class sp {
public:
    T* m_ptr;
};

class IBinder;

class ScreenshotClient
{
    char data[64]; //please adjust this value when you copy this definition to your real source!!!!!!!!!!!!!!!!!!!!!!!!
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
    uint32_t getStride() const; //base + getStride()*bytesPerPixel will get start address of next row
    int32_t getFormat() const;
    // size of allocated memory in bytes
    size_t getSize() const;
};

ScreenshotClient::ScreenshotClient() {
}

// frees the previous screenshot and capture a new one
int32_t ScreenshotClient::update() {
    return 1;
}
// frees the previous screenshot and capture a new one
int32_t ScreenshotClient::update(const sp<IBinder>& display) {
    return 1;
}

// pixels are valid until this object is freed or
// release() or update() is called
void const* ScreenshotClient::getPixels() const {
    return NULL;
}

uint32_t ScreenshotClient::getWidth() const {
    return 0;
}
uint32_t ScreenshotClient::getHeight() const {
    return 0;
}
uint32_t ScreenshotClient::getStride() const {
    return 0;
}
int32_t ScreenshotClient::getFormat() const {
    return 0;
}
// size of allocated memory in bytes
size_t ScreenshotClient::getSize() const {
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
    sp<IBinder> p;
    return p;
}

} //end of namespace android