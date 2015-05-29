#if !defined(libstagefright) && ANDROID_VER>=420
#define libstagefright

#include "libstagefright_foundation.h"

namespace android {

struct ABuffer;
struct ACodec;
struct AMessage;
struct AString;
struct SoftwareRenderer;
class ICrypto;
class Surface;
class IGraphicBufferProducer;
class SurfaceTextureClient;

struct MediaCodec : public AHandler {
    enum ConfigureFlags {
        CONFIGURE_FLAG_ENCODE   = 1,
    };

    enum BufferFlags {
        BUFFER_FLAG_SYNCFRAME   = 1,
        BUFFER_FLAG_CODECCONFIG = 2,
        BUFFER_FLAG_EOS         = 4,
    };

    static sp<MediaCodec> CreateByType(const sp<ALooper> &looper, const char *mime, bool encoder);
    #if (ANDROID_VER>=440)
        status_t configure(const sp<AMessage> &format, const sp<Surface> &nativeWindow, const sp<ICrypto> &crypto, uint32_t flags);
        status_t createInputSurface(sp<IGraphicBufferProducer>* bufferProducer);
    #elif (ANDROID_VER>=420)
        status_t configure(const sp<AMessage> &format, const sp<SurfaceTextureClient> &st, const sp<ICrypto> &crypto, uint32_t flags);
    #elif (ANDROID_VER>=440)
    #endif
    status_t start();
    status_t dequeueOutputBuffer(size_t *index, size_t *offset, size_t *size, int64_t *presentationTimeUs, uint32_t *flags, int64_t timeoutUs = 0ll);
    status_t releaseOutputBuffer(size_t index);
    status_t getOutputBuffers(Vector<sp<ABuffer> > *buffers) const;
    status_t getInputBuffers(Vector<sp<ABuffer> > *buffers) const;
    status_t dequeueInputBuffer(size_t *index, int64_t timeoutUs = 0ll);
    status_t queueInputBuffer(size_t index, size_t offset, size_t size, int64_t presentationTimeUs, uint32_t flags, AString *errorDetailMsg = NULL);

protected:
    virtual ~MediaCodec();
    virtual void onMessageReceived(const sp<AMessage> &msg);
private:
    char __data[sizeof(void*)*256];
    /*
    State mState;
    sp<ALooper> mLooper;
    sp<ALooper> mCodecLooper;
    sp<ACodec> mCodec;
    AString mComponentName;
    uint32_t mReplyID;
    uint32_t mFlags;
    sp<Surface> mNativeWindow;
    SoftwareRenderer *mSoftRenderer;
    sp<AMessage> mOutputFormat;

    List<size_t> mAvailPortBuffers[2];
    Vector<BufferInfo> mPortBuffers[2];

    int32_t mDequeueInputTimeoutGeneration;
    uint32_t mDequeueInputReplyID;

    int32_t mDequeueOutputTimeoutGeneration;
    uint32_t mDequeueOutputReplyID;

    sp<ICrypto> mCrypto;

    List<sp<ABuffer> > mCSD;

    sp<AMessage> mActivityNotify;

    bool mHaveInputSurface;
    */
};


} //end of namespace android

#endif //end of lib