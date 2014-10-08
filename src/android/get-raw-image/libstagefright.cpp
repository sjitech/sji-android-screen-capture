#include "libstagefright.h"
using namespace android;

sp<MediaCodec> MediaCodec::CreateByType(const sp<ALooper> &looper, const char *mime, bool encoder) {}
#if (ANDROID_VER>=440)
      status_t MediaCodec::configure(const sp<AMessage> &format, const sp<Surface> &nativeWindow, const sp<ICrypto> &crypto, uint32_t flags) {}
      status_t MediaCodec::createInputSurface(sp<IGraphicBufferProducer>* bufferProducer) {}
#endif
      status_t MediaCodec::start() {}
      status_t MediaCodec::dequeueOutputBuffer(size_t *index, size_t *offset, size_t *size, int64_t *presentationTimeUs, uint32_t *flags, int64_t timeoutUs) {}
      status_t MediaCodec::releaseOutputBuffer(size_t index) {}
      status_t MediaCodec::getOutputBuffers(Vector<sp<ABuffer> > *buffers) const {}
               MediaCodec::~MediaCodec() {}
      void     MediaCodec::onMessageReceived(const sp<AMessage> &msg) {}
