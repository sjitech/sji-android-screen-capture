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
#if MAKE_STD==1
    #include <new>
#endif

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
static DisplayInfo mainDispInfo;
static int capture_w, capture_h, logicalFrameSize;
class MyGraphicBufferProducer;
static MyGraphicBufferProducer* bp;
static bool alwaysRotate = false;
// static Vector<ComposerState> _emptyComposerStates; //dummy
// static Vector<DisplayState > _displayStates;
// static DisplayState* virtDispState = NULL;
static DisplayState* virtDispState = new DisplayState();
static int TRANS_ID_GET_DISPLAY_INFO = 0;
static int TRANS_ID_SET_DISPLAY_STATE = 0;

static Vector<sp<ABuffer> > ibfs;

#define BPP 4

#if MAKE_STD==1
    static sp<MediaCodec> codec;
#endif

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
    LOG("bpics");
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
    if (diff <= 0) ABORT("bad rbf vi");
    return code + diff;
}

static int convertOrient(int orient) {
    return !alwaysRotate ? orient : orient==0 ? 1 : orient==1 ? 0 : orient==2 ? 3 : orient==3 ? 2 : 4;
}

#if (ANDROID_VER>=500)
    #define MIN_DISP_INFO_HEAD 2*sizeof(int)  //vector head
#else
    #define MIN_DISP_INFO_HEAD 0
#endif
#define MIN_DISP_INFO_SIZE  (MIN_DISP_INFO_HEAD + ((size_t)&(((DisplayInfo*)NULL)->reserved)))

static int getOrient() {
    LOG("r go");
    // status_t err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);

    Parcel data, reply;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeStrongBinder(mainDisp);
    status_t err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
    if (err) ABORT("r go e %d", err);
    if (reply.dataSize() < MIN_DISP_INFO_SIZE) ABORT("r go s t l");
    DisplayInfo* info = (DisplayInfo*)(reply.data() + MIN_DISP_INFO_HEAD);
    LOG("r go o %d", info->orientation);
    return info->orientation;
}

static void setVirtDispOrient(int orient) {
    virtDispState->what = DisplayState::eDisplayProjectionChanged;
    virtDispState->orientation = convertOrient(orient);
    LOGI("r sds o %d mo %d", virtDispState->orientation, orient);
    //Although specified No wait, but android 4.2 still cause wait max 5 seconds, so do not use ISurfaceComposer nor SurfaceComposerClient
    // status_t err = __cs->setTransactionState(_emptyComposerStates, _displayStates, 0);

    Parcel data;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeInt32(0);
    data.writeInt32(1);
    virtDispState->write(data);
    data.writeInt32(0/*flags*/);
    status_t err = __csBinder->transact(TRANS_ID_SET_DISPLAY_STATE, data, NULL, 1/*TF_ONE_WAY*/);

    if (err) ABORT("r sds e %d", err);
    LOG(".r sds");
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
    bool mHaveData;
    int mConsumerUsage;
    int64_t mSeq;

    MyGraphicBufferProducer(int w, int h) : BnGraphicBufferProducer() {
        LOG("bp c w %d h %d", w, h);
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

    virtual ~MyGraphicBufferProducer() {
        LOG("bp d");
        delete mGBuf;
    }

    virtual status_t requestBuffer(int slot, sp<GraphicBuffer>* buf) {
        LOG("rbf %d", slot);
        if (slot != 0) ABORT("rbf %d n 0", slot);
        if (mGBuf == NULL) ABORT("rbf bg n");
        *buf = mGBuf;
        mIsGBufferRequested = true;
        return 0;
    }

    virtual status_t setBufferCount(int bufferCount) {
        if (bufferCount==1) LOG("sbc %d", bufferCount);
        else ABORT("sbc %d", bufferCount);
        return 0;
    }

    #if (ANDROID_VER>=440)
        virtual status_t dequeueBuffer(int *slot, sp<Fence>* fence, bool async, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #elif (ANDROID_VER>=430)
        virtual status_t dequeueBuffer(int *slot, sp<Fence>* fence, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #elif (ANDROID_VER>=420)
        virtual status_t dequeueBuffer(int *slot, sp<Fence>& fence, uint32_t w, uint32_t h, uint32_t format, uint32_t usage)
    #endif
    {
        #if (ANDROID_VER>=440)
            LOG("d w %d h %d f %d u 0x%x a %d", w, h, format, usage, async);
        #elif (ANDROID_VER>=420)
            LOG("d w %d h %d f %d u 0x%x", w, h, format, usage);
        #endif
        if (w != mWidth || h != mHeight) LOG("d w h abn");

        if (mGBuf==NULL) {
            if (format!=1 && format!=5) ABORT("f %d u", format);
            mFormat = format;
            int bpp = bytesPerPixel(format);
            if (bpp != BPP) ABORT("bpp %d u", bpp);

            mGBufUsage = (usage&~GRALLOC_USAGE_SW_READ_MASK)|mConsumerUsage;

            LOG("cr gb");
            mGBuf = new GraphicBuffer(mWidth, mHeight, mFormat, mGBufUsage);
            if (mGBuf==NULL) ABORT("n gb e");
            LOG("gb %p", mGBuf);

            LOG("g nb");
            ANativeWindowBuffer* nb = mGBuf->getNativeBuffer();
            LOGI("g nb r %p w %d h %d f %d s %d h %p", nb, nb->width, nb->height, nb->format, nb->stride, nb->handle);
            mInternalWidth = nb->stride;

            LOG("l gb");
            status_t err = mGBuf->lock(mConsumerUsage, (void**)&mGBufData);
            if (err || !mGBufData) ABORT("l gb e %d", err);
            LOG("l gb p %p", mGBufData);
        }
        else if (format != mFormat)  ABORT("d f %d n %d", format, mFormat);

        *slot = 0;
        #if (ANDROID_VER>=430)
            *fence = mFence; //set NULL cause android crash!!
        #elif (ANDROID_VER>=420)
            fence = mFence;
        #endif
        return mIsGBufferRequested ? 0 : IGraphicBufferProducer::BUFFER_NEEDS_REALLOCATION;
    }

    virtual status_t queueBuffer(int slot, const QueueBufferInput& input, QueueBufferOutput* output) {
        LOG("q %d i %p o %p sq %lld", slot, &input, output, ++mSeq);
        LOG("_q f.p %p cr %d %d %d %d sm %d tr %d", input.fence.get(), input.crop.left, input.crop.top, input.crop.right, input.crop.bottom, input.scalingMode, input.transform);
        LOG("_q f.f %d", input.fence==NULL?-1:input.fence->getFd());
        if (slot != 0) ABORT("q %d n 0", slot);
        if (output) {
            output->width = mWidth;
            output->height = mHeight;
            output->transformHint = 0;
            output->numPendingBuffers = 0;
        }

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
        virtual void cancelBuffer(int slot, const sp<Fence>& fence)
    #elif (ANDROID_VER>=420)
        virtual void cancelBuffer(int slot, sp<Fence> fence)
    #endif
    {
        LOG("cb %d", slot);
    }

    virtual int query(int what, int* value) { //what is defined in window.h
        int err = 0;
        switch(what) {
        case NATIVE_WINDOW_WIDTH:
        case NATIVE_WINDOW_DEFAULT_WIDTH:
            LOG("qr w");
            *value = mWidth;
            break;
        case NATIVE_WINDOW_HEIGHT:
        case NATIVE_WINDOW_DEFAULT_HEIGHT:
            LOG("qr h");
            *value = mHeight;
            break;
        case NATIVE_WINDOW_FORMAT:
            LOG("qr f");
            *value = mFormat;
            break;
        case NATIVE_WINDOW_CONSUMER_USAGE_BITS:
            LOG("qr cu");
            *value = mConsumerUsage;
            break;
        case NATIVE_WINDOW_MIN_UNDEQUEUED_BUFFERS:
            LOG("qr mub");
            *value = 0;
            break;
        case NATIVE_WINDOW_TRANSFORM_HINT:
            LOG("qr th");
            *value = 0;
            break;
        case NATIVE_WINDOW_QUEUES_TO_WINDOW_COMPOSER:
            LOG("qr qwc");
            *value = 0;
            break;
        case NATIVE_WINDOW_CONCRETE_TYPE:
            LOG("qr ct");
            *value = 0;
            break;
        default:
            LOG("qr %d", what);
            err = -EINVAL;
        }
        return err;
    }

    #if (ANDROID_VER<440)
    virtual status_t setSynchronousMode(bool enabled) {
        LOG("m %d", enabled);
        return 0;
    }
    #endif

    #if (ANDROID_VER>=440)
        virtual status_t connect(const sp<IBinder>& token, int api, bool producerControlledByApp, QueueBufferOutput* output)
    #elif (ANDROID_VER>=420)
        virtual status_t connect(int api, QueueBufferOutput* output)
    #endif
    {
        LOG("c %d %p", api, output);
        if (output) {
            output->width = mWidth;
            output->height = mHeight;
            output->transformHint = 0;
            output->numPendingBuffers = 0;
        }
        return 0;
    }

    virtual status_t disconnect(int api) {
        LOG("dc");
    }

    #if (ANDROID_VER>=500)
        virtual status_t detachBuffer(int slot) {LOG("dtb %d", slot); return -EINVAL;}
        virtual status_t detachNextBuffer(sp<GraphicBuffer>* outBuffer, sp<Fence>* outFence) {LOG("dtnb"); return -EINVAL;};
        virtual status_t attachBuffer(int* outSlot, const sp<GraphicBuffer>& buffer) {LOG("atb"); return -EINVAL;};
        virtual status_t setSidebandStream(/*const sp<NativeHandle>&*/void* stream) {LOG("ssbs"); return -EINVAL;};
        virtual void allocateBuffers(bool async, uint32_t width, uint32_t height, uint32_t format, uint32_t usage) {LOG("atb");};
    #endif

    virtual status_t onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0) {
        LOG("t %d ds %d", code, data.dataSize());
        #if 1 //(ANDROID_VER==420)
            // analyse time sequence, determin each code
            static int bpStepOfCode[32] = {0/*invalid step*/};
            if (code > 0 && code < sizeof(bpStepOfCode)/sizeof(bpStepOfCode[0])) {
                if (!bpStepOfCode[code]) { //every code will be handled once
                    static int step = 0;
                    if(++step <= bpStepMax) {
                        LOGI("rg %d st%d", code, step);
                        bpStepOfCode[code] = step;

                        int ind = bpCodeToVirtIndex(code);
                        if (ind != bpSteps[step].ind) {
                            LOG("n rd");
                            AutoMutex autoLock(mutex);
                            static PVTBL old_vtbl = NULL;
                            if (!old_vtbl) {
                                LOG("pr pt");
                                old_vtbl = PVTBL_OF(this);
                                // for(int i=-ghostCnt; i<normalCnt; i++) LOG("vtbl[%d]:%p", i, old_vtbl[i]);
                                enum{ ghostCnt = 16, normalCnt=64};
                                static VADDR new_vtbl[ghostCnt+normalCnt] = {0};
                                memcpy(new_vtbl, old_vtbl-ghostCnt, sizeof(new_vtbl));
                                LOG("pt vt %p %p", old_vtbl, new_vtbl + ghostCnt);
                                PVTBL_OF(this) = new_vtbl + ghostCnt;
                            }

                            LOG("rd %p %p i%d i%d", PVTBL_OF(this)[ind], old_vtbl[bpSteps[step].ind], ind, bpSteps[step].ind);
                            PVTBL_OF(this)[ind] = old_vtbl[bpSteps[step].ind];
                            LOG(".rd");
                        }
                    } else {
                        ABORT("t m b");
                    }
                }
            } else {
                LOG("ig c");
                code = -1;
            }
        #endif
        status_t err = BnGraphicBufferProducer::onTransact(code, data, reply, flags);
        LOG(".t %d r %d", code, err);
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
            LOGI("sn tr c %d", code);
            sniffered_transact_code = code;
            LOG("st sn");
            *p_cur_addr = old_addr;
            status_t err = ((IBinder*)this)->transact(code, data, reply, flags);
            if (reply) {
                LOG("rp %p %d %d", reply->data(), reply->dataSize(), reply->dataPosition());
                int len = reply->dataSize();
                for(int i = 0; i < len/sizeof(void*); i++) {
                    LOG("_rp %p", ((void**)reply->data())[i]);
                }
            }
            return err;
        }
    };

    if (!p_cur_addr) {
        LOG("pr pt");
        PVTBL old_vtbl = PVTBL_OF(binder);
        // for(int i=-ghostCnt; i<normalCnt; i++) LOG("vtbl[%d]:%p", i, old_vtbl[i]);
        enum{ ghostCnt = 8, normalCnt=64};
        static VADDR new_vtbl[ghostCnt+normalCnt] = {0};
        memcpy(new_vtbl, old_vtbl-ghostCnt, sizeof(new_vtbl));
        LOG("pt vt %p %p", old_vtbl, new_vtbl + ghostCnt);
        PVTBL_OF(binder) = new_vtbl + ghostCnt;

        int ind = getVirtFuncIndex(&IBinder::transact);
        if (ind >= normalCnt || ind <= 0) ABORT("b t vi");
        old_addr = old_vtbl[ind];
        if (!old_addr) ABORT("b t a");

        TransactSniffer sniffer;
        sniffer_addr = PVTBL_OF(&sniffer)[0];
        if (!sniffer_addr) ABORT("b s a");

        p_cur_addr = &PVTBL_OF(binder)[ind];
    }

    LOG("s sn");
    *p_cur_addr = sniffer_addr;
}

#if MAKE_TRIAL==1
static void chkDev() {
    #if (ANDROID_VER>=400)
        char key1[128] =  {0};
        char key2[128] =  {0};
        char m[256] = {0};
        char v[256] = {0};
        char m1[32] = {0};
        char m2[32] = {0};
        char v1[32] = {0};
        char v2[32] = {0};
        int i=0;
        key1[i++] = 'r'; key1[i++] = 'o'; key1[i++] = '.'; key1[i++] = 'p'; key1[i++] = 'r'; key1[i++] = 'o'; key1[i++] = 'd'; key1[i++] = 'u'; key1[i++] = 'c'; key1[i++] = 't'; key1[i++] = '.'; key1[i++] = 'm'; key1[i++] = 'o'; key1[i++] = 'd'; key1[i++] = 'e'; key1[i++] = 'l'; 
        i=0;
        key2[i++] = 'r'; key2[i++] = 'o'; key2[i++] = '.'; key2[i++] = 'b'; key2[i++] = 'u'; key2[i++] = 'i'; key2[i++] = 'l'; key2[i++] = 'd'; key2[i++] = '.'; key2[i++] = 'v'; key2[i++] = 'e'; key2[i++] = 'r'; key2[i++] = 's'; key2[i++] = 'i'; key2[i++] = 'o'; key2[i++] = 'n'; key2[i++] = '.'; key2[i++] = 'r'; key2[i++] = 'e'; key2[i++] = 'l'; key2[i++] = 'e'; key2[i++] = 'a'; key2[i++] = 's'; key2[i++] = 'e';
        i=0;
        m1[i++] = 'M'; m1[i++] = 'D'; m1[i++] = '-'; m1[i++] = '1'; m1[i++] = '0'; m1[i++] = '0'; m1[i++] = '8'; m1[i++] = 'B';
        i=0;
        v1[i++] = '4'; v1[i++] = '.'; v1[i++] = '2'; v1[i++] = '.'; v1[i++] = '2';
        i=0;
        m2[i++] = 'M'; m2[i++] = 'I'; m2[i++] = ' '; m2[i++] = 'P'; m2[i++] = 'A'; m2[i++] = 'D';
        i=0;
        v2[i++] = '4'; v2[i++] = '.'; v2[i++] = '2'; v2[i++] = '.'; v2[i++] = '4';
        property_get(key1, m, "");        LOG("[%s]", m);
        property_get(key2, v, "");        LOG("[%s]", v);
        if(0==strcmp(m, m1) && 0==strcmp(v, v1)) return;
        if(0==strcmp(m, m2) && 0==strcmp(v, v2)) return;
        ABORT("t m");
    #endif
}
#endif

static void asc_init(ASC* asc) {
    status_t err;
    #if MAKE_TRIAL==1
        if (time(NULL) >= 1416466615) ABORT("!");
        chkDev();
    #endif
    LOG("p %d", getpid());

    bpInitCallbackSteps();

    #if (ANDROID_VER>=430)
        //force loader fails in android 4.3, otherwise can not differ it with 4.4
        if (getpid()==-1) {
            sp<IBinder> tmp;
            SurfaceComposerClient::destroyDisplay(tmp);
        }
    #endif
    #if (ANDROID_VER>=500)
        //force loader fails in android 4.4, otherwise can not differ it with 5.0
        if (getpid()==-1) {
            ScreenshotClient s;
            sp<IBinder> d;
            status_t err = s.update(d, Rect(), 0, 0, false);
        }
    #endif

    LOG("stp");
    ProcessState::self()->startThreadPool();

    LOG("gs");
    __csBinder = defaultServiceManager()->getService(String16("SurfaceFlinger"));
    // __cs = ISurfaceComposer::asInterface(__csBinder);

    LOG("gbd");
    mainDisp = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
    if (mainDisp.get()==NULL) ABORT("gbd e");
    LOG("bd %p", mainDisp.get());

    sniffTransact(__csBinder);

    LOG("gd");
    err = SurfaceComposerClient::getDisplayInfo(mainDisp, &mainDispInfo);
    if (err) ABORT("gdi e %d", err);
    LOG("gd w %d h %d o %d", mainDispInfo.w, mainDispInfo.h, mainDispInfo.orientation);

    TRANS_ID_GET_DISPLAY_INFO = sniffered_transact_code;

    LOG("r gd");
    //some device use strange head file which put ISurfaceComposer::getMainDisplayInfo after getBuiltInDisplay so vptr index changed, so test here
    // err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);
    {
        Parcel data, reply;
        data.writeInterfaceToken(ISurfaceComposer::descriptor);
        data.writeStrongBinder(mainDisp);
        err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
        if (err) ABORT("r gd abn");
        if (reply.dataSize() < MIN_DISP_INFO_SIZE) ABORT("r gd s t l");
        DisplayInfo* info = (DisplayInfo*)(reply.data() + MIN_DISP_INFO_HEAD);
        if (info->w != mainDispInfo.w || info->h != mainDispInfo.h) ABORT("r gd abn. w %d h %d", info->w, info->h);
        mainDispInfo.orientation = info->orientation;
    }
    LOG(".r gd w %d h %d o %d", mainDispInfo.w, mainDispInfo.h, mainDispInfo.orientation);

    //sample mainDispInfo: {w:720, h:1280}

    LOG("o c r w %d h %d", asc->w, asc->h);
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
    logicalFrameSize = capture_w*capture_h*BPP;
    alwaysRotate = (mainDispInfo.w < mainDispInfo.h) != (capture_w < capture_h);
    LOG("c c r w %d h %d ar %d", capture_w, capture_h, alwaysRotate);
}

static void asc_create_virtual_display() {
    status_t err;
    Rect mainViewPort, virtViewPort;
    mainViewPort.right = mainViewPort.bottom = max(mainDispInfo.w, mainDispInfo.h);
    virtViewPort.right = virtViewPort.bottom = max(capture_w, capture_h);

    LOG("cd");
    virtDisp = SurfaceComposerClient::createDisplay(String8("QJASC"), true /*secure*/);
    if (virtDisp.get()==NULL) ABORT("cd e");

    bp = new MyGraphicBufferProducer(capture_w, capture_h);

    LOG("pr ds");
    SurfaceComposerClient::openGlobalTransaction();
    SurfaceComposerClient::setDisplaySurface(virtDisp, NULL);
    SurfaceComposerClient::setDisplayProjection(virtDisp, 0, /*layerStackRect:*/mainViewPort, /*displayRect:*/virtViewPort);
    SurfaceComposerClient::setDisplayLayerStack(virtDisp, 0);

    sniffTransact(__csBinder);

    LOG("t sds");
    SurfaceComposerClient::closeGlobalTransaction();

    TRANS_ID_SET_DISPLAY_STATE = sniffered_transact_code;

    LOG("pr r ds");
    // _displayStates.add();
    // virtDispState = _displayStates.editArray();
    virtDispState->what = DisplayState::eSurfaceChanged|DisplayState::eLayerStackChanged|DisplayState::eDisplayProjectionChanged;
    virtDispState->token = virtDisp;
    virtDispState->surface = bp;
    virtDispState->orientation = convertOrient(mainDispInfo.orientation);
    virtDispState->viewport = mainViewPort;
    virtDispState->frame = virtViewPort;
    virtDispState->layerStack = 0;
    LOG("r sds o %d mo %d", virtDispState->orientation, mainDispInfo.orientation);
    // __cs->setTransactionState(_emptyComposerStates, _displayStates, 0);
    {
        Parcel data;
        data.writeInterfaceToken(ISurfaceComposer::descriptor);
        data.writeInt32(0);
        data.writeInt32(1);
        virtDispState->write(data);
        data.writeInt32(0/*flags*/);
        status_t err = __csBinder->transact(TRANS_ID_SET_DISPLAY_STATE, data, NULL, 1/*TF_ONE_WAY*/);
        if (err) ABORT("r sds e %d", err);
    }
}

extern "C" void asc_capture(ASC* asc) {
    status_t err;
    AutoMutex autoLock(mutex);
    static int64_t seq = 0;

    if (isFirstTime) {
        asc_init(asc);
        asc_create_virtual_display();
    }

    #if ENABLE_RESEND
        if (!bp->mHaveData && !isFirstTime && lastTime.tv_sec) { //if there are data need be resent
            if ((lastTime.tv_nsec += RESEND_AFTER_NS) >= 1000000000) {
                lastTime.tv_nsec -= 1000000000;
                lastTime.tv_sec++;
            }
            LOG("dl mx %d ms 4 ru d", RESEND_AFTER_NS/1000000);
            if ((err=cond.waitAbsMono(mutex, &lastTime)) && err != -ETIMEDOUT) {
                LOG("w err:%d", err);
            }
            if (!bp->mHaveData) {
                LOGI("rt pr d sq %lld  t c c...", seq);
                lastTime.tv_sec = 0;
                return;
            }
        }
    #endif

    while ( !bp->mHaveData ) {
        LOG("w 4 d");
        cond.wait(mutex);
    }
    LOG("g n d e");
    bp->mHaveData = false;

    if (bp->mFence && bp->mFence->isValid()) {
         LOG("w 4 f");
         bp->mFence->wait(-1);
    }

    if (isFirstTime) {
        asc->w = bp->mInternalWidth;
        asc->h = bp->mHeight;
        strcpy(asc->pixfmtName, bp->mFormat==1?"rgb0":"bgr0");
        asc->size = bp->mInternalWidth*bp->mHeight*BPP;
        asc->data = bp->mGBufData;
    }
    
    seq++;
    LOG("r d sq:%lld t c c...", seq);

    if (isFirstTime) {
        if (! (getenv("ASC_LOG_ALL") && atoi(getenv("ASC_LOG_ALL")) > 0) )
            needLog = false;
        isFirstTime = false;
    }
}

#if MAKE_TEST==1
    extern "C" int main(int argc, char** argv) {
        ASC asc;
        memset(&asc, 0, sizeof(ASC));
        asc.w = argc>1 && atoi(argv[1])> 0 ? atoi(argv[1]) : 0;
        asc.h = argc>2 && atoi(argv[2])> 0 ? atoi(argv[2]) : 0;

        for(;;) {
            asc_capture(&asc);
            static int64_t seq = 0;
            LOGI("o i %lld", ++seq);
            write(1, asc.data, asc.size);
            #if 0
                LOG("encode to jpeg");
                SkData* streamData;
                {
                    SkBitmap b;
                    if (!b.setConfig(SkBitmap::kARGB_8888_Config, mWidth, mHeight, mInternalWidth*BPP)) ABORT("failed to setConfig");
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
    }
#endif

#if MAKE_STD==1
    static void* thread_feed_input(void* thd_param) {
        for(;;) {
            status_t err;
            AutoMutex autoLock(mutex);
            static int64_t seq = 0;


            LOG("codec->dequeueInputBuffer")
            int ibfs_index;
            err = codec->dequeueInputBuffer(&ibfs_index);
            if (err) ABORT('codec->dequeueInputBuffer err %d', err);


            while ( !bp->mHaveData ) {
                LOG("w 4 d");
                cond.wait(mutex);
            }
            LOG("g n d e");
            bp->mHaveData = false;

            if (bp->mFence && bp->mFence->isValid()) {
                 LOG("w 4 f");
                 bp->mFence->wait(-1);
            }

            LOG("copy data to codec input buf")
            if (bp->mInternalWidth==bp->mWidth) {
                memcpy(ibfs->get(ibfs_index)->base(), mGBufData, logicalFrameSize);
            } else {
                char* p1 = ibfs.get(ibfs_index)->base();
                char* p2 = bp->mGBufData;
                int size1 = bp->mWidth*BPP;
                int size2 = bp->mInternalWidth*BPP;
                for (int h=0; h < height; h++, p2 += size2, p1+= size1)
                    memmove(p1, p2, size1);
            }

            LOG("codec->queueInputBuffer")
            err = codec->queueInputBuffer(slot, 0, logicalFrameSize, ALooper::GetNowUs(), 0);
            if (err) ABORT("codec->queueInputBuffer err %d", err);

            seq++;
            LOG("r d sq:%lld t c c...", seq);

            if (isFirstTime) {
                if (! (getenv("ASC_LOG_ALL") && atoi(getenv("ASC_LOG_ALL")) > 0) )
                    needLog = false;
                isFirstTime = false;
            }
        }
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

    extern "C" int main(int argc, char** argv) {
        status_t err;

        mainThreadId = gettid();
        LOG("set sig handler for SIGINT, SIGHUP, SIGPIPE");
        signal(SIGINT, on_SIGINT);
        signal(SIGHUP, on_SIGHUP);
        signal(SIGPIPE, on_SIGPIPE);

        ASC asc;
        memset(&asc, 0, sizeof(ASC));
        asc.w = argc>1 && atoi(argv[1])> 0 ? atoi(argv[1]) : 0;
        asc.h = argc>2 && atoi(argv[2])> 0 ? atoi(argv[2]) : 0;

        asc_init(asc);

        // const char* vformat = "video/x-vnd.on2.vp8";
        const char* vformat = "video/avc";
        // const char* vformat = "video/mp4v-es";

        sp<AMessage> format = new AMessage;
        format->setInt32("width", capture_w);
        format->setInt32("height", capture_h);
        format->setString("mime", vformat);
        format->setInt32("color-format", 0x7F000789/*OMX_COLOR_FormatAndroidOpaque*/);
        format->setInt32("bitrate", 4000000);
        format->setFloat("frame-rate", 30);
        format->setInt32("i-frame-interval", 1);

        LOG("Creating ALooper");
        sp<ALooper> looper = new ALooper;
        looper->setName("screenrecord_looper");
        LOG("Starting ALooper");
        looper->start();

        LOG("Creating codec");
        codec = MediaCodec::CreateByType(looper, vformat, true/*encoder*/);
        if (codec.get() == NULL) ABORT("ERROR: unable to create codec instance");
        LOG("configure codec");
        static void* nullPtr = NULL;
        #if (ANDROID_VER>=440)
            err = codec->configure(format, *(sp<Surface>*)&nullPtr, *(sp<ICrypto>*)&nullPtr, 1/*CONFIGURE_FLAG_ENCODE*/);
        #elif (ANDROID_VER>=420)
            err = codec->configure(format, *(sp<SurfaceTextureClient>*)&nullPtr, *(sp<ICrypto>*)&nullPtr, 1/*CONFIGURE_FLAG_ENCODE*/);
        #endif
        if (err) ABORT("ERROR: unable to configure codec (err=%d)", err);

        LOG("Starting codec");
        err = codec->start();
        if (err) ABORT("ERROR: unable to start codec (err=%d)", err);

        Vector<sp<ABuffer> > obfs;
        LOG("getOutputBuffers");
        err = codec->getOutputBuffers(&obfs);
        if (err) ABORT("getOutputBuffers ret:%d", err);
        LOG("obfs cnt %d", obfs.size());

        LOG("getInputBuffers");
        err = codec->getInputBuffers(&ibfs);
        if (err) ABORT("getInputBuffers ret:%d", err);
        LOG("ibfs cnt %d", ibfs.size());

        pthread_t thd_feed_input;
        err = pthread_create(&thd_feed_input, NULL, thread_feed_input, NULL); 
        if (err) ABORT("pthread_create err %d", err);

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
        return 0;
    }
#endif
