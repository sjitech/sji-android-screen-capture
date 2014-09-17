#include "libgui.h"
using namespace android;

ScreenshotClient::ScreenshotClient() {}
#if (ANDROID_VER>=440)
    ScreenshotClient::~ScreenshotClient() {}
#endif
#if (ANDROID_VER>=420)
    status_t ScreenshotClient::update(const sp<IBinder>& display) {}
    status_t ScreenshotClient::update(const sp<IBinder>& display, uint32_t reqWidth, uint32_t reqHeight) {}
#elif (ANDROID_VER>=400)
    status_t ScreenshotClient::update() {}
    status_t ScreenshotClient::update(uint32_t reqWidth, uint32_t reqHeight) {}
#endif
void ScreenshotClient::release() {}
void const* ScreenshotClient::getPixels() const {}
uint32_t ScreenshotClient::getWidth() const {}
uint32_t ScreenshotClient::getHeight() const {}
uint32_t ScreenshotClient::getStride() const {}
int32_t ScreenshotClient::getFormat() const {}
size_t ScreenshotClient::getSize() const {}

#if (ANDROID_VER>=420)
    sp<IBinder> SurfaceComposerClient::getBuiltInDisplay(int32_t id) {}
    sp<IBinder> SurfaceComposerClient::createDisplay(const String8& displayName, bool secure) {}
    #if (ANDROID_VER>=440)
        void SurfaceComposerClient::destroyDisplay(const sp<IBinder>& display) {}
    #endif
    status_t SurfaceComposerClient::getDisplayInfo(const sp<IBinder>& display, DisplayInfo* info) {}
    void SurfaceComposerClient::openGlobalTransaction() {}
    void SurfaceComposerClient::closeGlobalTransaction(bool synchronous) {}
    #if (ANDROID_VER>=440)
        void SurfaceComposerClient::setDisplaySurface(const sp<IBinder>& token, const sp<IGraphicBufferProducer>& bufferProducer) {}
    #elif (ANDROID_VER>=420)
        void SurfaceComposerClient::setDisplaySurface(const sp<IBinder>& token, const sp<ISurfaceTexture>& bufferProducer) {}
    #endif
    void SurfaceComposerClient::setDisplayLayerStack(const sp<IBinder>& token, uint32_t layerStack) {}
    void SurfaceComposerClient::setDisplayProjection(const sp<IBinder>& token, uint32_t orientation, const Rect& layerStackRect, const Rect& displayRect) {}

    sp<ISurfaceComposer> ComposerService::getComposerService() {}
    
    const String16& ISurfaceComposer::getInterfaceDescriptor() const {}
    ISurfaceComposer::ISurfaceComposer() {}
    ISurfaceComposer::~ISurfaceComposer() {}


    #if (ANDROID_VER>=440)
        const String16& IGraphicBufferProducer::getInterfaceDescriptor() const {}
        IGraphicBufferProducer::IGraphicBufferProducer() {}
        IGraphicBufferProducer::~IGraphicBufferProducer() {}
        status_t BnGraphicBufferProducer::onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {}

    #elif (ANDROID_VER>=420)
        const String16& ISurfaceTexture::getInterfaceDescriptor() const {}
        ISurfaceTexture::ISurfaceTexture() {}
        ISurfaceTexture::~ISurfaceTexture() {}
        status_t BnSurfaceTexture::onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {}

        size_t ISurfaceTexture::QueueBufferInput::getFlattenedSize() const {}
        size_t ISurfaceTexture::QueueBufferInput::getFdCount() const {}
        status_t ISurfaceTexture::QueueBufferInput::flatten(void* buffer, size_t size, int fds[], size_t count) const {}
        status_t ISurfaceTexture::QueueBufferInput::unflatten(void const* buffer, size_t size, int fds[], size_t count) {}
    #endif

#elif (ANDROID_VER>=400)
    status_t SurfaceComposerClient::getDisplayInfo(int32_t id, DisplayInfo* info) {}
#endif
