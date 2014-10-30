#if (ANDROID_VER < 420)
    #error must define ANDROID_VER >= 420
#endif
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
#include <pthread.h>

#define LOG(fmt, arg...)           _LOG(fmt, ##arg)
#define ABORT(fmt, arg...)       ({_LOG(fmt ". Now exit", ##arg); exit(0);})
#define ABORT_ERRNO(fmt, arg...) ({_LOG(fmt " [errno %d(%s)] Now exit", errno, strerror(errno), ##arg); exit(0);})

static void _LOG(const char* format, ...) {
    char buf[4096];
    int cnt;
    va_list va;
    struct timespec ct;
    struct tm * st;
    clock_gettime(CLOCK_REALTIME, &ct);
    st = localtime(&ct.tv_sec);
    cnt = sprintf(buf, "%02d/%02d %02d:%02d:%02d.%03d [ASC %d] ", st->tm_mon+1, st->tm_mday, st->tm_hour, st->tm_min, st->tm_sec, (int)(ct.tv_nsec/1000000), gettid());
    va_start(va, format);
    cnt += vsnprintf(buf+cnt, sizeof(buf)-cnt, format, va);
    va_end(va);
    if (cnt > sizeof(buf)) cnt = sizeof(buf); else if (cnt <= 0) {cnt = 7; strcpy(buf, "LogErr");};
    if (buf[cnt-1]==0) cnt--; //always true
    if (buf[cnt-1]!='\n') buf[cnt++] = '\n';
    write(STDERR_FILENO, buf, cnt);
}

#include "libcutils.h"
#include "libgui.h"
#include "libui.h"
#include "libskia.h"
#include "libstagefright.h"

struct ASC_PRIV_DATA;
struct ASC {
    ASC_PRIV_DATA* priv_data;
    char* data;
    int size;
    int w; //short size
    int h; //long size
    char pixfmtName[32];
};

using namespace android;

static bool isFirstTime = true;
static bool needLog = true;
static Mutex mutex;
static Condition cond;
static sp<IBinder> __csBinder;
// static sp<ISurfaceComposer> __cs;
static sp<IBinder> mainDisp, virtDisp;
class MyGraphicBufferProducer;
static MyGraphicBufferProducer* bp;
static bool alwaysRotate = false;
// static Vector<ComposerState> _emptyComposerStates; //dummy
// static Vector<DisplayState > _displayStates;
// static DisplayState* virtDispState = NULL;
static DisplayState* virtDispState = new DisplayState();
#if (ANDROID_VER>=440)
    static int TRANS_ID_GET_DISPLAY_INFO = 12;
    static int TRANS_ID_SET_DISPLAY_STATE = 8;
#elif (ANDROID_VER>=420)
    static int TRANS_ID_GET_DISPLAY_INFO = 12;
    static int TRANS_ID_SET_DISPLAY_STATE = 7;
#endif

#undef ENABLE_RESEND
#if (ANDROID_VER<440)
    #define ENABLE_RESEND 1
#endif

#if ENABLE_RESEND 
    static struct timespec lastTime = {0};
    // #define SEND_AFTER_NS  ((int)(0.005*1000000000))
    #define SEND_AFTER_NS  0
    #define RESEND_AFTER_NS ((int)(1000000000*0.25-SEND_AFTER_NS))
#endif

#define toEvenInt(n) ((int)(ceil(((float)(n))/2)*2))
#define min(a,b) ((a) < (b) ? (a) : (b))
#define max(a,b) ((a) > (b) ? (a) : (b))

static int convertOrient(int orient) {
    return !alwaysRotate ? orient : orient==0 ? 1 : orient==1 ? 0 : orient==2 ? 3 : orient==3 ? 2 : 4;
}

static int getOrient() {
    DisplayInfo mainDispInfo;
    if (needLog) LOG("getOrient");
    // status_t err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);

    Parcel data, reply;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeStrongBinder(mainDisp);
    __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
    status_t err = reply.read(&mainDispInfo, (size_t)(&((DisplayInfo*)NULL)->orientation+1));

    if (err) ABORT("getOrient err:%d", err);
    if (needLog) LOG("getOrient result:%d", mainDispInfo.orientation);
    return mainDispInfo.orientation;
}

static void setVirtDispOrient(int orient) {
    virtDispState->what = DisplayState::eDisplayProjectionChanged;
    virtDispState->orientation = convertOrient(orient);
    if (isFirstTime) LOG("setXxxxState orient:%d (mainDisp.orient:%d)", virtDispState->orientation, orient);
    //Although specified No wait, but android 4.2 still cause wait max 5 seconds, so do not use ISurfaceComposer nor SurfaceComposerClient
    // status_t err = __cs->setTransactionState(_emptyComposerStates, _displayStates, 0);

    Parcel data;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeInt32(0);
    data.writeInt32(1);
    virtDispState->write(data);
    data.writeInt32(0/*flags*/);
    status_t err = __csBinder->transact(TRANS_ID_SET_DISPLAY_STATE, data, NULL, 1/*TF_ONE_WAY*/);

    if (err) ABORT("setXxxxState err:%d", err);
    if (isFirstTime) LOG("setXxxxState OK");
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
    int64_t mSeq;

    MyGraphicBufferProducer(int w, int h) : BnGraphicBufferProducer() {
        LOG("MyBufferQueue::ctor w:%d h:%d ++++++++++++++++++++++++++++++++", w, h);
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
        mSeq = 0;
    }

    /*virtual*/ ~MyGraphicBufferProducer() {
        LOG("MyBufferQueue::dtor --------------------------------");
        delete mGBuf;
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
        if (bufferCount==1) LOG("setBufferCount %d", bufferCount);
        else ABORT("setBufferCount %d", bufferCount);
        return 0;
    }

    #if (ANDROID_VER>=440)
        /*virtual*/ status_t dequeueBuffer(int *slot, sp<Fence>* fence, bool async, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #elif (ANDROID_VER>=430)
        /*virtual*/ status_t dequeueBuffer(int *slot, sp<Fence>* fence, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #elif (ANDROID_VER>=420)
        /*virtual*/ status_t dequeueBuffer(int *slot, sp<Fence>& fence, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #endif
    {
        #if (ANDROID_VER>=440)
            if (needLog) LOG("dequeueBuffer w:%d h:%d fmt:%d usg:0x%x async %d", w, h, format, usage, async);
        #elif (ANDROID_VER>=420)
            if (needLog) LOG("dequeueBuffer w:%d h:%d fmt:%d usg:0x%x", w, h, format, usage);
        #endif
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
        }
        else if (format != mFormat)  ABORT("dequeueBuffer fmt:%d!=%d", format, mFormat);

        *slot = 0;
        #if (ANDROID_VER>=430)
            *fence = mFence; //set NULL cause android crash!!
        #elif (ANDROID_VER>=420)
            fence = mFence;
        #endif
        return mIsGBufferRequested ? 0 : IGraphicBufferProducer::BUFFER_NEEDS_REALLOCATION;
    }

    /*virtual*/ status_t queueBuffer(int slot, const QueueBufferInput& input, QueueBufferOutput* output) {
        if (needLog) LOG("queueBuffer %d fenceId:%d crop:%d %d %d %d scalingMode:%d transform:%d __seq:%lld", slot, input.fence==NULL?-1:input.fence->getFd(), input.crop.left, input.crop.top, input.crop.right, input.crop.bottom, input.scalingMode, input.transform, ++mSeq);
        if (slot != 0) ABORT("queueBuffer slot:%d!=0", slot);
        output->width = mWidth;
        output->height = mHeight;
        output->transformHint = 0;
        output->numPendingBuffers = 0;

        int orient = getOrient();
        if (convertOrient(orient) != virtDispState->orientation) {
            setVirtDispOrient(orient);
            mFence = input.fence;
            #if ENABLE_RESEND
                if(lastTime.tv_sec) cond.signal(); //wake up resend thread
            #endif
        } else {
            AutoMutex autoLock(mutex);
            mHaveData = true;
            mFence = input.fence;
            #if ENABLE_RESEND
                clock_gettime(CLOCK_MONOTONIC, &lastTime);
            #endif
            cond.signal(); //anyway wake up main or resend thread
        }
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
            if (needLog) LOG("query NATIVE_WINDOW_WIDTH");
            *value = mWidth;
            break;
        case NATIVE_WINDOW_HEIGHT:
            if (needLog) LOG("query NATIVE_WINDOW_HEIGHT");
            *value = mHeight;
            break;
        case NATIVE_WINDOW_FORMAT:
            if (needLog) LOG("query NATIVE_WINDOW_FORMAT");
            *value = mFormat;
            break;
        case NATIVE_WINDOW_CONSUMER_USAGE_BITS:
            if (needLog) LOG("query NATIVE_WINDOW_CONSUMER_USAGE_BITS");
            *value = mConsumerUsage;
            break;
        default:
            ABORT("query %d", what);
            err = -EINVAL;
        }
        return err;
    }

    #if (ANDROID_VER<440)
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
        LOG("disconnected");
    }

    /*virtual*/status_t onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0) {
        if (needLog) LOG("onTransact %d dataSize:%d", code, data.dataSize());
        //todo: follow time sequence, determin each action id
        status_t err = BnGraphicBufferProducer::onTransact(code, data, reply, flags);
        // LOG("onTransact %d result:%d", code, err);
        return err;
    }
};

void asc_init(ASC* asc) {
    status_t err;
    LOG("start. pid %d", getpid());

    #if (ANDROID_VER>=430)
        //force loader fails in android 4.3, otherwise can not differ it with 4.4
        if (getpid()==-1) {
            sp<IBinder> tmp;
            SurfaceComposerClient::destroyDisplay(tmp);
        }
    #endif

    LOG("startThreadPool");
    ProcessState::self()->startThreadPool();

    LOG("getService");
    __csBinder = defaultServiceManager()->getService(String16("SurfaceFlinger"));
    // __cs = ISurfaceComposer::asInterface(__csBinder);

    LOG("getMainDisplay");
    mainDisp = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
    if (mainDisp.get()==NULL) ABORT("getBuiltInDisplay err:unknown");
    LOG("mainDisp: %p", mainDisp.get());

    DisplayInfo mainDispInfo;
    LOG("getMainDisplayInfo");
    err = SurfaceComposerClient::getDisplayInfo(mainDisp, &mainDispInfo);
    if (err) ABORT("getMainDisplayInfo err:%d", err);
    LOG("try raw getMainDisplayInfo interface");
    //some device use strange head file which put ISurfaceComposer::getMainDisplayInfo after getBuiltInDisplay so vptr index changed, so test here
    // err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);
    {
        DisplayInfo info; //todo: save stack
        Parcel data, reply; //todo: save stack
        data.writeInterfaceToken(ISurfaceComposer::descriptor);
        data.writeStrongBinder(mainDisp);
        err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
        err = reply.read(&info, (size_t)(&((DisplayInfo*)NULL)->orientation+1));
        if (err || info.w != mainDispInfo.w || info.h != mainDispInfo.h) {
            LOG("raw getMainDisplayInfo interface is abnormal, retry with special interface ********");
            TRANS_ID_GET_DISPLAY_INFO++;
        }
    }
    {
        DisplayInfo info; //todo: save stack
        Parcel data, reply; //todo: save stack
        data.writeInterfaceToken(ISurfaceComposer::descriptor);
        data.writeStrongBinder(mainDisp);
        err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
        err = reply.read(&info, (size_t)(&((DisplayInfo*)NULL)->orientation+1));
        if (err || info.w != mainDispInfo.w || info.h != mainDispInfo.h)
            ABORT("raw getMainDisplayInfo interface is abnormal");
        mainDispInfo.orientation = info.orientation;
    }
    if (err) ABORT("getMainDisplayInfo err:%d", err);
    LOG("mainDispInfo: w:%d h:%d orient:%d", mainDispInfo.w, mainDispInfo.h, mainDispInfo.orientation);

    //sample mainDispInfo: {w:720, h:1280}

    LOG("original  capture request: w:%d h:%d", asc->w, asc->h);
    int capture_w, capture_h;
    if (!asc->w && !asc->h) {  //normal case
        capture_w = mainDispInfo.w;
        capture_h = mainDispInfo.h;
    } else if (asc->w && !asc->h) {
        capture_w = toEvenInt(asc->w);
        capture_h = toEvenInt(asc->w*mainDispInfo.h/mainDispInfo.w);
    } else if (asc->h && !asc->w) {
        capture_h = toEvenInt(asc->h);
        capture_w = toEvenInt(asc->h*mainDispInfo.w/mainDispInfo.h);
    } else { //asc->w && asc->h
        capture_w = toEvenInt(asc->w);
        capture_h = toEvenInt(asc->h);
    }
    alwaysRotate = (mainDispInfo.w < mainDispInfo.h) != (capture_w < capture_h);
    LOG("converted capture request: w:%d h:%d alwaysRotate:%d", capture_w, capture_h, alwaysRotate);

    Rect mainViewPort, virtViewPort;
    mainViewPort.right = mainViewPort.bottom = max(mainDispInfo.w, mainDispInfo.h);
    virtViewPort.right = virtViewPort.bottom = max(capture_w, capture_h);

    LOG("createXxxx");
    virtDisp = SurfaceComposerClient::createDisplay(String8("QJASC"), true /*secure*/);
    if (virtDisp.get()==NULL) ABORT("createXxxx err:unknown");

    bp = new MyGraphicBufferProducer(capture_w, capture_h);

    LOG("prepare XxxxStates");
    // _displayStates.add();
    // virtDispState = _displayStates.editArray();
    virtDispState->what = DisplayState::eSurfaceChanged|DisplayState::eLayerStackChanged|DisplayState::eDisplayProjectionChanged;
    virtDispState->token = virtDisp;
    virtDispState->surface = bp;
    virtDispState->orientation = convertOrient(mainDispInfo.orientation);
    virtDispState->viewport = mainViewPort;
    virtDispState->frame = virtViewPort;
    virtDispState->layerStack = 0;
    LOG("setXxxxState orient:%d (mainDisp.orient:%d)", virtDispState->orientation, mainDispInfo.orientation);
    #if 1
        // __cs->setTransactionState(_emptyComposerStates, _displayStates, 0);
        {
            Parcel data;
            data.writeInterfaceToken(ISurfaceComposer::descriptor);
            data.writeInt32(0);
            data.writeInt32(1);
            virtDispState->write(data);
            data.writeInt32(0/*flags*/);
            status_t err = __csBinder->transact(TRANS_ID_SET_DISPLAY_STATE, data, NULL, 1/*TF_ONE_WAY*/);
            if (err) ABORT("setXxxxState err:%d", err);
        }
    #else
        SurfaceComposerClient::openGlobalTransaction();
        SurfaceComposerClient::setDisplaySurface(virtDisp, bp);
        SurfaceComposerClient::setDisplayProjection(virtDisp, virtDispState.orientation, /*layerStackRect:*/mainViewPort, /*displayRect:*/virtViewPort);
        SurfaceComposerClient::setDisplayLayerStack(virtDisp, 0);
        SurfaceComposerClient::closeGlobalTransaction();
    #endif
}

extern "C" void asc_capture(ASC* asc) {
    status_t err;
    AutoMutex autoLock(mutex);
    static int64_t seq = 0;

    if (isFirstTime)
        asc_init(asc);

    #if ENABLE_RESEND
        if (!bp->mHaveData && !isFirstTime && lastTime.tv_sec) { //if there are data need be resent
            if ((lastTime.tv_nsec += RESEND_AFTER_NS) >= 1000000000) {
                lastTime.tv_nsec -= 1000000000;
                lastTime.tv_sec++;
            }
            if (needLog) LOG("delay max %d ms for reuse data", RESEND_AFTER_NS/1000000);
            if ((err=cond.waitAbsMono(mutex, &lastTime)) && err != -ETIMEDOUT) {
                if (needLog) LOG("waitAbsMono err:%d", err);
            }
            if (!bp->mHaveData) {
                if (needLog) LOG("return previous data (seq:%lld) then continue capturing... ******** \n\n", seq);
                lastTime.tv_sec = 0;
                return;
            }
        }
    #endif

    while ( !bp->mHaveData ) {
        if (needLog) LOG("wait for data");
        cond.wait(mutex);
    }
    if (needLog) LOG("got new data event");
    bp->mHaveData = false;

    if (bp->mFence && bp->mFence->isValid()) {
         if (needLog) LOG("wait for fence");
         bp->mFence->wait(-1);
    }

    #if 0
        #if ENABLE_RESEND
            if ((lastTime.tv_nsec += SEND_AFTER_NS) >= 1000000000) {
                lastTime.tv_nsec -= 1000000000;
                lastTime.tv_sec++;
            }
            if (needLog) LOG("delay max %d ms for read data", SEND_AFTER_NS/1000000);
            if ((err=cond.waitAbsMono(mutex, &lastTime)) && err != -ETIMEDOUT) {
                if (needLog) LOG("waitAbsMono err:%d", err);
            }
        #endif
    #endif

    if (isFirstTime) {
        asc->w = bp->mInternalWidth;
        asc->h = bp->mHeight;
        if (bp->mBytesPerPixel!=4) {
            ABORT("bytesPerPixel:%d unexcepted", bp->mBytesPerPixel);
        }
        if (bp->mFormat!=1 && bp->mFormat!=5) {
            ABORT("format:%d unexcepted", bp->mFormat);
        }
        strcpy(asc->pixfmtName, bp->mFormat==1?"rgb0":"bgr0");
        asc->size = bp->mInternalWidth*bp->mHeight*bp->mBytesPerPixel;
        asc->data = bp->mGBufData;
    }
    
    seq++;
    if (needLog) LOG("return data (seq:%lld) then continue capturing...\n\n", seq);

    if (isFirstTime) {
        if (! (getenv("ASC_LOG_ALL") && atoi(getenv("ASC_LOG_ALL")) > 0) )
            needLog = false;
        isFirstTime = false;
    }
}

#if MAKE_TEST
    #if 0
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
    #endif

int main(int argc, char** argv){
    #if 0
        mainThreadId = gettid();
        LOG("set sig handler for SIGINT, SIGHUP, SIGPIPE");
        signal(SIGINT, on_SIGINT);
        signal(SIGHUP, on_SIGHUP);
        signal(SIGPIPE, on_SIGPIPE);
    #endif

    ASC asc;
    memset(&asc, 0, sizeof(ASC));
    asc.w = argc>1 && atoi(argv[1])> 0 ? atoi(argv[1]) : 0;
    asc.h = argc>2 && atoi(argv[2])> 0 ? atoi(argv[2]) : 0;
    for(;;) {
        asc_capture(&asc);
        static int64_t seq = 0;
        if (needLog) LOG("output image %lld ********", ++seq);
        write(1, asc.data, asc.size);
        #if 0
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
        #endif
    }

#if 0
    sp<AMessage> format = new AMessage;
    format->setInt32("width", capture_w);
    format->setInt32("height", capture_h);
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

    LOG("joinThreadPool");
    IPCThreadState::self()->joinThreadPool(/*isMain*/true);
    ABORT("unexpected here");
#endif
    return 0;
}
#endif
