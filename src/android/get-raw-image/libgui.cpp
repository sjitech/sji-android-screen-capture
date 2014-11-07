#include "libgui.h"
using namespace android;

ScreenshotClient::ScreenshotClient() {}
#if (ANDROID_VER>=500)
    status_t update(const sp<IBinder>& display, Rect sourceCrop, uint32_t reqWidth, uint32_t reqHeight, bool useIdentityTransform) {}
#elif (ANDROID_VER>=430)
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
    void SurfaceComposerClient::destroyDisplay(const sp<IBinder>& display) {}
    status_t SurfaceComposerClient::getDisplayInfo(const sp<IBinder>& display, DisplayInfo* info) {}
    void SurfaceComposerClient::openGlobalTransaction() {}
    void SurfaceComposerClient::closeGlobalTransaction(bool synchronous) {}
    void SurfaceComposerClient::setDisplaySurface(const sp<IBinder>& token, const sp<IGraphicBufferProducer>& bufferProducer) {}
    void SurfaceComposerClient::setDisplayLayerStack(const sp<IBinder>& token, uint32_t layerStack) {}
    void SurfaceComposerClient::setDisplayProjection(const sp<IBinder>& token, uint32_t orientation, const Rect& layerStackRect, const Rect& displayRect) {}
    void SurfaceComposerClient::blankDisplay(const sp<IBinder>& display) {}
    void SurfaceComposerClient::unblankDisplay(const sp<IBinder>& display) {}

    sp<ISurfaceComposer> ComposerService::getComposerService() {}

    const android::String16 ISurfaceComposer::descriptor;
    const String16& ISurfaceComposer::getInterfaceDescriptor() const {}
    ISurfaceComposer::ISurfaceComposer() {}
    ISurfaceComposer::~ISurfaceComposer() {}
    sp<ISurfaceComposer> ISurfaceComposer::asInterface(const sp<IBinder>& obj) {}

    #if (ANDROID_VER>=430)
        const String16& IGraphicBufferProducer::getInterfaceDescriptor() const {}
        IGraphicBufferProducer::IGraphicBufferProducer() {}
        IGraphicBufferProducer::~IGraphicBufferProducer() {}
        status_t BnGraphicBufferProducer::onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {}
    #elif (ANDROID_VER>=420)
        const String16& ISurfaceTexture::getInterfaceDescriptor() const {}
        ISurfaceTexture::ISurfaceTexture() {}
        ISurfaceTexture::~ISurfaceTexture() {}
        status_t BnSurfaceTexture::onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {}
    #endif

    status_t DisplayState::write(Parcel& output) const {}
#endif
