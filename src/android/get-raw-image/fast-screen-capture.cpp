#include <unistd.h>
#include <sys/types.h>
#include <fcntl.h>
#include <linux/fb.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <errno.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <math.h>
#include <err.h>
#include <stdbool.h>
#include <sys/time.h>
#include <time.h>
#include <signal.h>

#if (ANDROID_VER < 420)
    #error must define ANDROID_VER >= 420
#endif

#include "libcutils.h"
#include "libgui.h"
#include "libui.h"
#include "libskia.h"
#include "libstagefright.h"

#define FRAME_BUFFER_DEV "/dev/graphics/fb0"

#define LOG(fmt, arg...)      _LOG(fmt "\n", ##arg)
#define LOGERR(fmt, arg...)   _LOG("[errno %d(%s)]" fmt "\n", errno, strerror(errno), ##arg)
#define ABORT_ERRNO(fmt, arg...) ({_LOG("[errno %d(%s)]" fmt ". Now exit\n", errno, strerror(errno), ##arg); exit(0);})
#define ABORT(fmt, arg...)  ({_LOG(fmt ". Now exit\n", ##arg); exit(0);})

extern "C" void _LOG(const char* format, ...) {
    char buf[4096];
    int cnt;
    va_list va;
    struct timeval tv;
    long long mms;
    time_t t;
    struct tm * st;

    gettimeofday(&tv, NULL);
    mms = ((long long) tv.tv_sec) * (1000 * 1000) + tv.tv_usec;
    t = time(NULL);
    st = localtime(&t);

    memset(buf, 0, sizeof(buf));
    sprintf(buf, "%02d/%02d %02d:%02d:%02d.%06d [ASC %d:%d]",
        st->tm_mon+1,
        st->tm_mday,
        st->tm_hour,
        st->tm_min,
        st->tm_sec,
        (int)(mms%1000000)
        ,getpid(), gettid()
        );
    cnt = strlen(buf);

    va_start(va, format);
    vsnprintf(buf+cnt, sizeof(buf)-cnt-1, format, va);
    va_end(va);

    cnt = strlen(buf); //gcc 3.3 snprintf can not correctly return copied length, so i have to count by myself
    if (cnt==0 || buf[cnt-1]!='\n') {
        buf[cnt++] = '\n';
    }
    write(STDERR_FILENO, buf, cnt);
}

static int mainThreadId = 0;

static void cleanup(const char* msg) {
    if (gettid() == mainThreadId) ABORT("%s", msg);
}

static void on_SIGPIPE(int signum) {
    cleanup("pipe peer ended first, no problem");
}
static void on_SIGINT(int signum) {
    cleanup("SIGINT(Ctl+C)");
}
static void on_SIGHUP(int signum) {
    cleanup("SIGHUP(adb shell terminated)");
}

// hack android OS head file
using namespace android;

// static pthread_mutex_t mMutex;
// static pthread_cond_t mCond;
sp<IBinder> mainDisp;

static bool isRotated() {

}

struct MyGraphicBufferProducer : public BnGraphicBufferProducer {
    int mWidth;
    int mHeight;
    volatile int mInUsing;
    bool mIsGBufferRequested;
    sp<Fence> mFence;
    PixelFormat mFormat;
    GraphicBuffer* mGBuf;
    int mGBufUsage;
    char* mGBufData;
    int mInternalWidth;
    int mBytesPerPixel;
    bool mHaveData;
    int mConsumerUsage;

    MyGraphicBufferProducer(int w, int h) : BnGraphicBufferProducer() {
        LOG("MyGraphicBufferProducer::ctor");
        mWidth = w;
        mHeight = h;
        mInUsing = 0;
        mIsGBufferRequested = false;
        mGBuf = NULL;
        mGBufData = NULL;
        mHaveData = false;
        mFence = Fence::NO_FENCE;
        mFormat = HAL_PIXEL_FORMAT_RGBA_8888;
        mConsumerUsage = GRALLOC_USAGE_SW_READ_OFTEN;
    }

    /*virtual*/ ~MyGraphicBufferProducer() {
        LOG("MyGraphicBufferProducer::dtor");
    }

    /*virtual*/ status_t requestBuffer(int slot, sp<GraphicBuffer>* buf) {
        LOG("requestBuffer %d", slot);
        if (slot != 0) ABORT("requestBuffer slot:%d!=0", slot);
        if (mGBuf == NULL) ABORT("requestBuffer mGBuf==NULL");
        *buf = mGBuf;
        mIsGBufferRequested = true;
        return 0;
    }

    /*virtual*/ status_t setBufferCount(int bufferCount) {
        LOG("setBufferCount %d", bufferCount);
        return 0;
    }

    #if (ANDROID_VER>=440)
        /*virtual*/ status_t dequeueBuffer(int *slot, sp<Fence>* fence, bool async, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #elif (ANDROID_VER>=420)
        /*virtual*/ status_t dequeueBuffer(int *slot, sp<Fence>& fence, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #endif
    {
        #if (ANDROID_VER>=440)
            LOG("dequeueBuffer w:%d h:%d fmt:%d usg:0x%x async %d", w, h, format, usage, async);
        #elif (ANDROID_VER>=420)
            LOG("dequeueBuffer w:%d h:%d fmt:%d usg:0x%x", w, h, format, usage);
        #endif
        _lock();

        if (w != mWidth || h != mHeight) ABORT("dequeueBuffer w:%d!=%d h:%d!=%d", w, mWidth, h, mHeight);

        if (mGBuf==NULL) {
            mFormat = format;
            mGBufUsage = (usage&~GRALLOC_USAGE_SW_READ_MASK)|mConsumerUsage;
            mBytesPerPixel = bytesPerPixel(format);
            LOG("bytesPerPixel: %d", mBytesPerPixel);
            LOG("createGraphicBuffer");
            mGBuf = new GraphicBuffer(mWidth, mHeight, mFormat, mGBufUsage);
            if (mGBuf==NULL) ABORT("new GraphicBuffer error");
            LOG("mGBuf:%p", mGBuf);

            LOG("getNativeBuffer");
            ANativeWindowBuffer* nb = mGBuf->getNativeBuffer();
            LOG("getNativeBuffer result:%p w:%d h:%d f:%d stride:%d handle:%p", nb, nb->width, nb->height, nb->format, nb->stride, nb->handle);
            mInternalWidth = nb->stride;

            LOG("lock gbuf");
            status_t err = mGBuf->lock(mConsumerUsage, (void**)&mGBufData);
            if (err || !mGBufData) ABORT("lock gbuf err:%d", err);
            LOG("mGBuf lock data ptr:%p", mGBufData);
//            LOG("unlock gbuf");
//            err = mGBuf->unlock();
//            if (err) ABORT("unlock gbuf err:%d", err);
        }
        else if (format != mFormat)  ABORT("dequeueBuffer fmt:%d!=%d", format, mFormat);

        *slot = 0;
        #if (ANDROID_VER>=440)
            *fence = mFence; //set NULL cause android crash!!
        #elif (ANDROID_VER>=420)
            fence = mFence;
        #endif
        return mIsGBufferRequested ? 0 : IGraphicBufferProducer::BUFFER_NEEDS_REALLOCATION;
    }

    /*virtual*/ status_t queueBuffer(int slot, const QueueBufferInput& input, QueueBufferOutput* output) {
        LOG("queueBuffer %d fenceId:%d crop:%d %d %d %d scalingMode:%d", slot, input.fence==NULL?-1:input.fence->getFd(), input.crop.left, input.crop.top, input.crop.right, input.crop.bottom, input.scalingMode);
        // if (input.crop.left || input.crop.top || input.crop.right || input.crop.bottom)
        //     return -EINVAL;
        if (slot != 0) ABORT("queueBuffer slot:%d!=0", slot);
        mFence = input.fence;
        output->width = mWidth;
        output->height = mHeight;
        output->transformHint = 0;
        output->numPendingBuffers = 0;

        // LOG("********************* data[10]:%d data[10000]:%d\n", mGBufData[10], mGBufData[10000]);
        this->output();

        _unlock();
        return 0;
    }

    void output() {
        static int counterDown = 3;
        if (--counterDown > 0) {
            LOG("count down: %d", counterDown);
            return;
        }
        if (mFence && mFence->isValid()) {
            LOG("wait fence************************************");
            mFence->wait(-1);
        }
        write(1, mGBufData, mInternalWidth*mHeight*mBytesPerPixel);
        exit(0);
        return;
        LOG("encode to jpeg");
        SkData* streamData;
        {
            SkBitmap b;
            if (!b.setConfig(SkBitmap::kARGB_8888_Config, mWidth, mHeight, mInternalWidth*mBytesPerPixel)) ABORT("failed to setConfig");
            b.setPixels(mGBufData);
            SkDynamicMemoryWStream stream;
            if (!SkImageEncoder::EncodeStream(&stream, b, SkImageEncoder::kJPEG_Type, 100)) ABORT("failed to encode to jpeg");
            LOG("get jpeg");
            streamData = stream.copyToData();
            write(1/*stdout*/, streamData->p, streamData->size);
        }
        delete streamData;
    }

    #if (ANDROID_VER>=440)
        /*virtual*/ void cancelBuffer(int slot, const sp<Fence>& fence)
    #elif (ANDROID_VER>=420)
        /*virtual*/ void cancelBuffer(int slot, sp<Fence> fence)
    #endif
    {
        ABORT("cancelBuffer");
    }

    /*virtual*/ int query(int what, int* value) { //what is defined in window.h
        int err = 0;
        switch(what) {
        case NATIVE_WINDOW_WIDTH:
            LOG("query NATIVE_WINDOW_WIDTH");
            *value = mWidth;
            break;
        case NATIVE_WINDOW_HEIGHT:
            LOG("query NATIVE_WINDOW_HEIGHT");
            *value = mHeight;
            break;
        case NATIVE_WINDOW_FORMAT:
            LOG("query NATIVE_WINDOW_FORMAT");
            *value = mFormat;
            break;
        case NATIVE_WINDOW_CONSUMER_USAGE_BITS:
            LOG("query NATIVE_WINDOW_CONSUMER_USAGE_BITS");
            *value = mConsumerUsage;
            break;
        default:
            LOG("query %d", what);
            err = -EINVAL;
        }
        return err;
    }

    #if (ANDROID_VER>=440)
        //
    #elif (ANDROID_VER>=420)
    /*virtual*/ status_t setSynchronousMode(bool enabled) {
        LOG("setSynchronousMode %d", enabled);
        return 0;
    }
    #endif

    #if (ANDROID_VER>=440)
        /*virtual*/ status_t connect(const sp<IBinder>& token, int api, bool producerControlledByApp, QueueBufferOutput* output)
    #elif (ANDROID_VER>=420)
        /*virtual*/ status_t connect(int api, QueueBufferOutput* output)
    #endif
    {
        #if (ANDROID_VER>=440)
            LOG("connect api:%d token:%p producerControlledByApp:%d", api, &token, producerControlledByApp);
        #elif (ANDROID_VER>=420)
            LOG("connect api:%d", api);
        #endif
        output->width = mWidth;
        output->height = mHeight;
        output->transformHint = 0;
        output->numPendingBuffers = 0;
        return 0;
    }

    /*virtual*/ status_t disconnect(int api) {
        ABORT("disconnected by gui system");
    }

    inline void _lock() {
        while (android_atomic_cmpxchg(/*old:*/0, /*new:*/1, /*target:*/&mInUsing) /*return !=0 means failed*/) {
            if (gettid() != mainThreadId) LOG("failed to lock, so sleep a while then lock again");
            usleep(10*1000);
        }
    }

    inline void _unlock() {
        android_atomic_cmpxchg(/*old:*/1, /*new:*/0, /*target:*/&mInUsing);
    }

};

int main(int argc, char** argv) {
    LOG("start. pid %d", getpid());
    mainThreadId = gettid();
    status_t err;

    LOG("set sig handler for SIGINT, SIGHUP, SIGPIPE");
    signal(SIGINT, on_SIGINT);
    signal(SIGHUP, on_SIGHUP);
    signal(SIGPIPE, on_SIGPIPE);

    // pthread_mutex_init(&mMutex, NULL);
    // pthread_cond_init(&mCond, NULL);

    LOG("startThreadPool");
    ProcessState::self()->startThreadPool();
#if 0
    sp<AMessage> format = new AMessage;
    format->setInt32("width", virtDispRect.right);
    format->setInt32("height", virtDispRect.bottom);
    format->setString("mime", "video/avc");
    format->setInt32("color-format", 0x7F000789/*OMX_COLOR_FormatAndroidOpaque*/);
    format->setInt32("bitrate", 4000000);
    format->setFloat("frame-rate", 60);
    format->setInt32("i-frame-interval", 10);

    LOG("Creating ALooper");
    sp<ALooper> looper = new ALooper;
    looper->setName("screenrecord_looper");
    LOG("Starting ALooper");
    looper->start();

    LOG("Creating codec");
    sp<MediaCodec> codec = MediaCodec::CreateByType(looper, "video/avc", true);
    if (codec.get() == NULL)
        ABORT("ERROR: unable to create video/avc codec instance\n");
    LOG("configure codec");
    err = codec->configure(format, NULL, NULL, MediaCodec::CONFIGURE_FLAG_ENCODE);
    if (err)
        ABORT("ERROR: unable to configure codec (err=%d)\n", err);

    LOG("Creating buffer producer");
    sp<IGraphicBufferProducer> bufferProducer;
    err = codec->createInputSurface(&bufferProducer);
    if (err)
        ABORT("ERROR: unable to create codec input surface (err=%d)\n", err);

    LOG("Starting codec");
    err = codec->start();
    if (err)
        ABORT("ERROR: unable to start codec (err=%d)\n", err);
#endif

    LOG("getBuiltInDisplay");
    mainDisp = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
    if (mainDisp.get()==NULL) ABORT("getBuiltInDisplay err:unknown");

    DisplayInfo mainDispInfo;
    LOG("getDisplayInfo");
    err = SurfaceComposerClient::getDisplayInfo(mainDisp, &mainDispInfo);
    if (err) ABORT("getDisplayInfo err:%d", err);
    LOG("mainDispInfo: w:%d h:%d", mainDispInfo.w, mainDispInfo.h); //sample: w:720 h:1280

    int mainDispSizeS = mainDispInfo.w, mainDispSizeL = mainDispInfo.h;
    int virtDispSizeS = mainDispSizeS/*can be changed*/, virtDispSizeL = mainDispSizeL*virtDispSizeS/mainDispSizeS;
    Rect mainDispRect, virtDispRect;
    mainDispRect.right = mainDispRect.bottom = mainDispSizeL;
    virtDispRect.right = virtDispRect.bottom = virtDispSizeL;
    LOG("mainDispRect: w:%d h:%d x:%d y:%d", mainDispRect.right-mainDispRect.left, mainDispRect.bottom-mainDispRect.top, mainDispRect.left, mainDispRect.top);
    LOG("virtDispRect: w:%d h:%d x:%d y:%d", virtDispRect.right-virtDispRect.left, virtDispRect.bottom-virtDispRect.top, virtDispRect.left, virtDispRect.top);

    sp<IGraphicBufferProducer> bufProducer = new MyGraphicBufferProducer(virtDispSizeS, virtDispSizeL);

    LOG("createDisplay");
    sp<IBinder> virtDisp = SurfaceComposerClient::createDisplay(String8("ScreenRecorder"), false /*secure*/);
    if (virtDisp.get()==NULL) ABORT("createDisplay err:unknown");

    LOG("openGlobalTransaction");
    SurfaceComposerClient::openGlobalTransaction();
    LOG("setDisplaySurface");
    SurfaceComposerClient::setDisplaySurface(virtDisp, bufProducer);
    LOG("setDisplayProjection");
    SurfaceComposerClient::setDisplayProjection(virtDisp, 1, /*layerStackRect:*/mainDispRect, /*displayRect:*/virtDispRect);
    LOG("setDisplayLayerStack");
    SurfaceComposerClient::setDisplayLayerStack(virtDisp, 0);
    LOG("closeGlobalTransaction");
    SurfaceComposerClient::closeGlobalTransaction();

#if 0
    Vector<sp<ABuffer> > buffers;
    LOG("getOutputBuffers");
    err = codec->getOutputBuffers(&buffers);
    if (err)
        ABORT("prepareEncoder ret:%d", err);

    while (true) {
        size_t bufIndex, offset, size;
        int64_t ptsUsec;
        uint32_t flags;

        LOG("dequeueOutputBuffer");
        err = codec->dequeueOutputBuffer(&bufIndex, &offset, &size, &ptsUsec, &flags, 250000);
        switch (err) {
        case 0:
            if ((flags & MediaCodec::BUFFER_FLAG_CODECCONFIG) != 0) {
                LOG("Got codec config buffer (%u bytes); ignoring", size);
                size = 0;
            }
            if (size != 0) {
                LOG("Got data in buffer %d, size=%d, pts=%lld", bufIndex, size, ptsUsec);
            }

            LOG("releaseOutputBuffer");
            err = codec->releaseOutputBuffer(bufIndex);
            LOG("releaseOutputBuffer ret:%d", err);
            break;
        default:
            LOG("dequeueOutputBuffer ret:%d", err);
            // exit(0);
            // return err;
        }
    }
#endif

    // pthread_cond_wait(&mCond, &mutex.mMutex);
    // pthread_cond_signal(&mCond);

    // for(;;) {
    //     bufProducer->_lock();
    //     bufProducer->output();
    //     bufProducer->_unlock();
    //     LOG("...");
    //     usleep(1000*1000/30);
    // }

    IPCThreadState::self()->joinThreadPool(/*isMain*/true);
    ABORT("unexpected here");
}
