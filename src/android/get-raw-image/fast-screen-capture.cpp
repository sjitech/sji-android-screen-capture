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
#include "libcutils.h"
#include "libgui.h"
#include "libui.h"
#include "libskia.h"
#include "libstagefright.h"

using namespace android;

struct ASC_PRIV_DATA;
struct ASC {
    ASC_PRIV_DATA* priv_data;
    char* data;
    int size;
    int w; //short size
    int h; //long size
    char pixfmtName[32];
};

#define LOG(fmt, arg...)         ({static bool __logged=false; if (needLog||!__logged){_LOG("%s" fmt "%s", needLog?"":"--------rare case--------", ##arg, needLog?"":"\n\n");__logged=true;}})
#define LOGI(fmt, arg...)        LOG("--------" fmt "\n\n", ##arg)
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
static int TRANS_ID_GET_DISPLAY_INFO = 0;
static int TRANS_ID_SET_DISPLAY_STATE = 0;

struct CallbackStep {
    int ind;
    const char* name;
};
static CallbackStep bpSteps[1/*invalid step 0*/+32] = {0};
static int bpStepMax = 0;



typedef void* VADDR;
typedef VADDR* PVTBL;
#define PVTBL_OF(inst) (*((PVTBL*)(inst)))
#define getVirtFuncIndex(f) _getVirtFuncIndex(0, f)
static int _getVirtFuncIndex(int dummy, ...) {
    int i;
    va_list va;
    va_start(va, dummy);
    i = va_arg(va, int);
    va_end(va);
    return i/sizeof(VADDR);
}

#define INIT_NEXT_CALLBACK_STEP(virtFuncName) ({ \
    if (++bpStepMax >= sizeof(bpSteps)/sizeof(bpSteps[0])-1) ABORT("too many bpSteps"); \
    bpSteps[bpStepMax].ind = getVirtFuncIndex(&IGraphicBufferProducer::virtFuncName); \
    bpSteps[bpStepMax].name = #virtFuncName; \
})

static void bpInitCallbackSteps() {
    LOG("bpInitCallbackSteps");
    INIT_NEXT_CALLBACK_STEP(query);
    INIT_NEXT_CALLBACK_STEP(connect);
    #if (ANDROID_VER<440)
        INIT_NEXT_CALLBACK_STEP(setSynchronousMode);
    #endif
    INIT_NEXT_CALLBACK_STEP(dequeueBuffer);
    INIT_NEXT_CALLBACK_STEP(requestBuffer);
    INIT_NEXT_CALLBACK_STEP(queueBuffer);
}

static int bpCodeToVirtIndex(uint32_t code) {
    static int diff = -1;
    if (diff == -1)
        diff = getVirtFuncIndex(&IGraphicBufferProducer::requestBuffer)-1/*code*/;
    if (diff <= 0) ABORT("bad requestBuffer vindex");
    return code + diff;
}

static int convertOrient(int orient) {
    return !alwaysRotate ? orient : orient==0 ? 1 : orient==1 ? 0 : orient==2 ? 3 : orient==3 ? 2 : 4;
}

static int getOrient() {
    DisplayInfo mainDispInfo;
    LOG("raw getOrient");
    // status_t err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);

    Parcel data, reply;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeStrongBinder(mainDisp);
    status_t err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
    err = err ? err : reply.read(&mainDispInfo, (size_t)(&((DisplayInfo*)NULL)->orientation+1));

    if (err) ABORT("raw getOrient err:%d", err);
    LOG("raw getOrient result:%d", mainDispInfo.orientation);
    return mainDispInfo.orientation;
}

static void setVirtDispOrient(int orient) {
    virtDispState->what = DisplayState::eDisplayProjectionChanged;
    virtDispState->orientation = convertOrient(orient);
    LOGI("raw setXxxxState orient:%d (mainDisp.orient:%d)", virtDispState->orientation, orient);
    //Although specified No wait, but android 4.2 still cause wait max 5 seconds, so do not use ISurfaceComposer nor SurfaceComposerClient
    // status_t err = __cs->setTransactionState(_emptyComposerStates, _displayStates, 0);

    Parcel data;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeInt32(0);
    data.writeInt32(1);
    virtDispState->write(data);
    data.writeInt32(0/*flags*/);
    status_t err = __csBinder->transact(TRANS_ID_SET_DISPLAY_STATE, data, NULL, 1/*TF_ONE_WAY*/);

    if (err) ABORT("raw setXxxxState err:%d", err);
    LOG("raw setXxxxState OK");
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
        LOG("MyBufferQueue::ctor w:%d h:%d", w, h);
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
        LOG("MyBufferQueue::dtor");
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
            LOG("dequeueBuffer w:%d h:%d fmt:%d usg:0x%x async %d", w, h, format, usage, async);
        #elif (ANDROID_VER>=420)
            LOG("dequeueBuffer w:%d h:%d fmt:%d usg:0x%x", w, h, format, usage);
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
            LOGI("getNativeBuffer result:%p w:%d h:%d f:%d stride:%d handle:%p", nb, nb->width, nb->height, nb->format, nb->stride, nb->handle);
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
        LOG("queueBuffer %d fenceId:%d crop:%d %d %d %d scalingMode:%d transform:%d __seq:%lld", slot, input.fence==NULL?-1:input.fence->getFd(), input.crop.left, input.crop.top, input.crop.right, input.crop.bottom, input.scalingMode, input.transform, ++mSeq);
        if (slot != 0) ABORT("queueBuffer slot:%d!=0", slot);
        output->width = mWidth;
        output->height = mHeight;
        output->transformHint = 0;
        output->numPendingBuffers = 0;

        int orient = getOrient();

        AutoMutex autoLock(mutex);
        mFence = input.fence;

        if (convertOrient(orient) != virtDispState->orientation) {
            setVirtDispOrient(orient);
            #if ENABLE_RESEND
                if(lastTime.tv_sec) cond.signal(); //wake up resend thread
            #endif
        } else {
            mHaveData = true;
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
        LOG("onTransact %d dataSize:%d", code, data.dataSize());
        #if 1 //(ANDROID_VER==420)
            // analyse time sequence, determin each code
            static int bpStepOfCode[32] = {0/*invalid step*/};
            if (code > 0 && code < sizeof(bpStepOfCode)/sizeof(bpStepOfCode[0])) {
                if (!bpStepOfCode[code]) { //every code will be handled once
                    static int step = 0;
                    if(++step <= bpStepMax) {
                        LOGI("register code %d as step%d(%s)", code, step, bpSteps[step].name);
                        bpStepOfCode[code] = step;

                        int ind = bpCodeToVirtIndex(code);
                        if (ind != bpSteps[step].ind) {
                            LOG("need redirect");
                            AutoMutex autoLock(mutex);
                            static PVTBL old_vtbl = NULL;
                            if (!old_vtbl) {
                                LOG("prepare patch");
                                old_vtbl = PVTBL_OF(this);
                                // for(int i=-ghostCnt; i<normalCnt; i++) LOG("vtbl[%d]:%p", i, old_vtbl[i]);
                                enum{ ghostCnt = 16, normalCnt=64};
                                static VADDR new_vtbl[ghostCnt+normalCnt] = {0};
                                memcpy(new_vtbl, old_vtbl-ghostCnt, sizeof(new_vtbl));
                                LOG("patch vtbl:%p -> %p", old_vtbl, new_vtbl + ghostCnt);
                                PVTBL_OF(this) = new_vtbl + ghostCnt;
                            }

                            LOG("redirect %p -> %p", PVTBL_OF(this)[ind], old_vtbl[bpSteps[step].ind]);
                            PVTBL_OF(this)[ind] = old_vtbl[bpSteps[step].ind];
                        }
                    } else {
                        ABORT("too many bpSteps");
                    }
                }
            } else {
                LOG("ignore code");
                code = -1;
            }
        #endif
        status_t err = BnGraphicBufferProducer::onTransact(code, data, reply, flags);
        // LOG("onTransact %d result:%d", code, err);
        return err;
    }
};

static uint32_t sniffered_transact_code = 0;

void sniffTransact(IBinder* binder) {
    static VADDR old_addr = NULL;
    static VADDR sniffer_addr = NULL;
    static VADDR* p_cur_addr = NULL;

    struct TransactSniffer {
        virtual status_t transact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {
            LOGI("sniffered transact code: %d", code);
            sniffered_transact_code = code;
            LOG("stop sniff");
            *p_cur_addr = old_addr;
            return ((IBinder*)this)->transact(code, data, reply, flags);
        }
    };

    if (!p_cur_addr) {
        LOG("prepare patch");
        PVTBL old_vtbl = PVTBL_OF(binder);
        // for(int i=-ghostCnt; i<normalCnt; i++) LOG("vtbl[%d]:%p", i, old_vtbl[i]);
        enum{ ghostCnt = 4, normalCnt=32};
        static VADDR new_vtbl[ghostCnt+normalCnt] = {0};
        memcpy(new_vtbl, old_vtbl-ghostCnt, sizeof(new_vtbl));
        LOG("patch vtbl:%p -> %p", old_vtbl, new_vtbl + ghostCnt);
        PVTBL_OF(binder) = new_vtbl + ghostCnt;

        int ind = getVirtFuncIndex(&IBinder::transact);
        if (ind >= normalCnt || ind <= 0) ABORT("bad transact vindex");
        old_addr = old_vtbl[ind];
        if (!old_addr) ABORT("bad transact addr");

        TransactSniffer sniffer;
        sniffer_addr = PVTBL_OF(&sniffer)[0];
        if (!sniffer_addr) ABORT("bad sniffer addr");

        p_cur_addr = &PVTBL_OF(binder)[ind];
    }

    LOG("start sniff");
    *p_cur_addr = sniffer_addr;
}

void asc_init(ASC* asc) {
    status_t err;
    LOG("start. pid %d", getpid());

    bpInitCallbackSteps();

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

    sniffTransact(__csBinder);

    DisplayInfo mainDispInfo;
    LOG("getMainDisplayInfo");
    err = SurfaceComposerClient::getDisplayInfo(mainDisp, &mainDispInfo);
    if (err) ABORT("getMainDisplayInfo err:%d", err);

    TRANS_ID_GET_DISPLAY_INFO = sniffered_transact_code;

    LOG("raw getMainDisplayInfo");
    //some device use strange head file which put ISurfaceComposer::getMainDisplayInfo after getBuiltInDisplay so vptr index changed, so test here
    // err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);
    {
        DisplayInfo info; //todo: save stack
        Parcel data, reply; //todo: save stack
        data.writeInterfaceToken(ISurfaceComposer::descriptor);
        data.writeStrongBinder(mainDisp);
        err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
        err = err ? err : reply.read(&info, (size_t)(&((DisplayInfo*)NULL)->orientation+1));
        if (err || info.w != mainDispInfo.w || info.h != mainDispInfo.h)
            ABORT("raw getMainDisplayInfo interface is abnormal");
        mainDispInfo.orientation = info.orientation;
    }
    if (err) ABORT("raw getMainDisplayInfo err:%d", err);
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
    SurfaceComposerClient::openGlobalTransaction();
    SurfaceComposerClient::setDisplaySurface(virtDisp, NULL);
    SurfaceComposerClient::setDisplayProjection(virtDisp, 0, /*layerStackRect:*/mainViewPort, /*displayRect:*/virtViewPort);
    SurfaceComposerClient::setDisplayLayerStack(virtDisp, 0);

    sniffTransact(__csBinder);

    LOG("test setXxxxState");
    SurfaceComposerClient::closeGlobalTransaction();

    TRANS_ID_SET_DISPLAY_STATE = sniffered_transact_code;

    LOG("prepare raw XxxxStates");
    // _displayStates.add();
    // virtDispState = _displayStates.editArray();
    virtDispState->what = DisplayState::eSurfaceChanged|DisplayState::eLayerStackChanged|DisplayState::eDisplayProjectionChanged;
    virtDispState->token = virtDisp;
    virtDispState->surface = bp;
    virtDispState->orientation = convertOrient(mainDispInfo.orientation);
    virtDispState->viewport = mainViewPort;
    virtDispState->frame = virtViewPort;
    virtDispState->layerStack = 0;
    LOG("raw setXxxxState orient:%d (mainDisp.orient:%d)", virtDispState->orientation, mainDispInfo.orientation);
    // __cs->setTransactionState(_emptyComposerStates, _displayStates, 0);
    {
        Parcel data;
        data.writeInterfaceToken(ISurfaceComposer::descriptor);
        data.writeInt32(0);
        data.writeInt32(1);
        virtDispState->write(data);
        data.writeInt32(0/*flags*/);
        status_t err = __csBinder->transact(TRANS_ID_SET_DISPLAY_STATE, data, NULL, 1/*TF_ONE_WAY*/);
        if (err) ABORT("raw setXxxxState err:%d", err);
    }
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
            LOG("delay max %d ms for reuse data", RESEND_AFTER_NS/1000000);
            if ((err=cond.waitAbsMono(mutex, &lastTime)) && err != -ETIMEDOUT) {
                LOG("waitAbsMono err:%d", err);
            }
            if (!bp->mHaveData) {
                LOGI("return previous data (seq:%lld) then continue capturing...", seq);
                lastTime.tv_sec = 0;
                return;
            }
        }
    #endif

    while ( !bp->mHaveData ) {
        LOG("wait for data");
        cond.wait(mutex);
    }
    LOG("got new data event");
    bp->mHaveData = false;

    if (bp->mFence && bp->mFence->isValid()) {
         LOG("wait for fence");
         bp->mFence->wait(-1);
    }

    #if 0
        #if ENABLE_RESEND
            if ((lastTime.tv_nsec += SEND_AFTER_NS) >= 1000000000) {
                lastTime.tv_nsec -= 1000000000;
                lastTime.tv_sec++;
            }
            LOG("delay max %d ms for read data", SEND_AFTER_NS/1000000);
            if ((err=cond.waitAbsMono(mutex, &lastTime)) && err != -ETIMEDOUT) {
                LOG("waitAbsMono err:%d", err);
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
    LOG("return data (seq:%lld) then continue capturing...", seq);

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

int main(int argc, char** argv) {
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
        LOGI("output image %lld", ++seq);
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
