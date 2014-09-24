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

static int64_t microSecondOfNow() {
    struct timeval t;
    gettimeofday(&t, NULL);
    return ((int64_t) t.tv_sec) * (1000 * 1000) + t.tv_usec;
}

static int mainThreadId = 0;

static void cleanup(const char* msg) {
    if (gettid() != mainThreadId) return;
    ABORT("%s", msg);
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

struct MyGraphicBufferProducer : public BnGraphicBufferProducer {
    int mWidth;
    int mHeight;
    volatile int mInUsing;
    bool mIsGBufferRequested;
    sp<Fence> mFence;
    PixelFormat mFormat;
    sp<GraphicBuffer> mGBuf;
    int mGBufUsage;
    char* mGBufData;

    MyGraphicBufferProducer(int w, int h) : BnGraphicBufferProducer() {
        LOG("MyGraphicBufferProducer::ctor");
        mWidth = w;
        mHeight = h;
        mInUsing = 0;
        mIsGBufferRequested = false;
        mFence = Fence::NO_FENCE;
        mGBufData = NULL;
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
            mGBufUsage = usage;
            LOG("createGraphicBuffer");
            mGBuf = new GraphicBuffer(mWidth, mHeight, mFormat, usage|GRALLOC_USAGE_SW_READ_OFTEN);
            if (mGBuf==NULL) ABORT("new GraphicBuffer error");
            LOG("mGBuf:%p", mGBuf.get());

            LOG("getNativeBuffer");
            ANativeWindowBuffer* nb = mGBuf->getNativeBuffer();
            LOG("getNativeBuffer result:%p w:%d h:%d f:%d stride:%d handle:%p", nb, nb->width, nb->height, nb->format, nb->stride, nb->handle);

            if (mGBuf != NULL) {
                LOG("lock gbuf");
                status_t err = mGBuf->lock(GRALLOC_USAGE_SW_READ_OFTEN, (void**)&mGBufData);
                if (err || !mGBufData) ABORT("lock gbuf err:%d", err);
                LOG("mGBuf lock data ptr:%p", mGBufData);
                // if (!err) {
                //     LOG("unlock gbuf");
                //     err = mGBuf->unlock();
                //     if (err) ABORT("unlock gbuf err:%d", err);
                // }
            }
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

        // if (mFence && mFence->isValid()) {
        //     LOG("wait fence");
        //     mFence->wait(-1);
        // }

        LOG("********************* data:%d\n", mGBufData[10]);

        _unlock();
        return 0;
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
            *value = GRALLOC_USAGE_SW_READ_OFTEN;
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
            LOG("failed to lock, so sleep a while then lock again");
            usleep(1);
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

    LOG("startThreadPool");
    ProcessState::self()->startThreadPool();

    LOG("getBuiltInDisplay");
    sp<IBinder> mainDisp = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
    if (mainDisp.get()==NULL) ABORT("getBuiltInDisplay err:unknown");

    DisplayInfo mainDispInfo;
    LOG("getDisplayInfo");
    err = SurfaceComposerClient::getDisplayInfo(mainDisp, &mainDispInfo);
    if (err) ABORT("getDisplayInfo err:%d", err);

    Rect mainDispRect, virtDispRect;
    mainDispRect.right = mainDispInfo.w;
    mainDispRect.bottom = mainDispInfo.h;
    virtDispRect.right = mainDispInfo.w;
    virtDispRect.bottom = mainDispInfo.h;
    LOG("mainDispInfo: w:%d h:%d", mainDispInfo.w, mainDispInfo.h);
    LOG("virtDisp: w:%d h:%d", virtDispRect.right, virtDispRect.bottom);

    sp<IGraphicBufferProducer> bufProducer = new MyGraphicBufferProducer(virtDispRect.right, virtDispRect.bottom);

    LOG("createDisplay");
    sp<IBinder> virtDisp = SurfaceComposerClient::createDisplay(String8("ScreenRecorder"), false /*secure*/);
    if (virtDisp.get()==NULL) ABORT("createDisplay err:unknown");

    LOG("openGlobalTransaction");
    SurfaceComposerClient::openGlobalTransaction();
    LOG("setDisplaySurface");
    SurfaceComposerClient::setDisplaySurface(virtDisp, bufProducer);
    LOG("setDisplayProjection");
    SurfaceComposerClient::setDisplayProjection(virtDisp, 0, /*layerStackRect:*/mainDispRect, /*displayRect:*/virtDispRect);
    LOG("setDisplayLayerStack");
    SurfaceComposerClient::setDisplayLayerStack(virtDisp, 0);
    LOG("closeGlobalTransaction");
    SurfaceComposerClient::closeGlobalTransaction();

    LOG("...");
    IPCThreadState::self()->joinThreadPool(/*isMain*/true);
    ABORT("unexpected here");
}
