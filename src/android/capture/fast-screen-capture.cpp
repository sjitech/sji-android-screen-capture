#if (ANDROID_VER < 420)
    #error must define ANDROID_VER >= 420
#endif
#include <unistd.h>
#include <sys/types.h>
#include <fcntl.h>
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
#include <termios.h>
#include <pthread.h>
#include <linux/input.h>
#include <sys/un.h>
#include <sys/socket.h>

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

static bool needLog = true;
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

static bool isPaused = false;
static bool isScreenOff = false;
static char* blackscreen = NULL;
static int blackscreen_extra_count = 0;

static Mutex mutex;
static Condition cond;

static bool isFirstTime = true;

static void chkDev() {
    char k[128] = {0};
    char _sn[256] = {0};
    char *sn = _sn;
    char hb[4+1] = {'0','0','0','0', 0};
    char now[6+1] = {0};
    const char* es;
    char* ds;
    char* err;
    int i=0, esLen, snLen, dsLen;
    unsigned int ec, sc, dc;
    struct timespec ct;
    struct tm * st;

    es=getenv("ASC_");
    if (!es || !es[0]) ABORT("!nes");
    esLen = strlen(es);
    if (esLen%(2*6) != 0) ABORT("!esl");
    dsLen = esLen/2;

    //getprop android_id from net.hostname
    k[i=0] = 'n'; k[++i] = 'e'; k[++i] = 't'; k[++i] = '.'; k[++i] = 'h'; k[++i] = 'o'; k[++i] = 's'; k[++i] = 't'; k[++i] = 'n'; k[++i] = 'a'; k[++i] = 'm'; k[++i] = 'e'; k[++i] = 0;
    property_get(k, sn, " ");
    snLen = strlen(sn);
    if (snLen > 8) {
        sn += 8;
        snLen -= 8;
    } else {
        //getprop ro.serialno
        k[i=0] = 'r'; k[++i] = 'o'; k[++i] = '.'; k[++i] = 's'; k[++i] = 'e'; k[++i] = 'r'; k[++i] = 'i'; k[++i] = 'a'; k[++i] = 'l'; k[++i] = 'n'; k[++i] = 'o'; k[++i] = 0;
        property_get(k, sn, " ");
        snLen = strlen(sn);
    }

    if ( dsLen != (snLen+6-1)/6*6 ) ABORT("!esms %d %d %d", snLen, (snLen+6-1)/6*6, dsLen);

    ds = (char*)calloc(dsLen+1, 1);
    for(i=0; i < dsLen; i++) {
        //hb[0] = hb[1] = '0';
        hb[2] = es[i*2];
        hb[3] = es[i*2+1];
        ec = (unsigned int)strtoul(hb, &err, 16);
        if (err&&err[0]) ABORT("!ec", err);
        sc = (unsigned int)(unsigned char)sn[i%snLen];
        dc = ec ^ sc;
        if (dc < '0' || dc > '9') ABORT("!dcd");
        ds[i] = (char)dc;
    }
    for (i = 6; i < dsLen; i += 6)
        if ( 0 != memcmp(ds, &ds[i], 6)) ABORT("!dsfd");

    clock_gettime(CLOCK_REALTIME, &ct);
    st = localtime(&ct.tv_sec);
    sprintf(now, "%02d%02d%02d", (st->tm_year+1900-2000), st->tm_mon+1, st->tm_mday);

    if (memcmp(now, ds, 6) > 0) ABORT("!to");
    free(ds);
}

static void* thread_cmd_socket_server(void* thd_param) {
    int socket_server_fd = (int)thd_param;
    for(;;) {
        LOG("accept");
        int connection_fd = accept(socket_server_fd, NULL, NULL);
        if (connection_fd == -1) {
            LOG("accept err %d", errno);
            continue;
        }

        for(;;) {
            unsigned char cmd;
            LOG("read cmd");
            if (read(connection_fd, &cmd, sizeof(cmd)) != sizeof(cmd)) {
                LOG("read err %d", errno);
                break;
            }
            LOGI("handle cmd: %c (%d)", cmd, cmd);

            AutoMutex autoLock(mutex);
            switch (cmd) {
            case '+': //start
                if (isPaused) {
                    isPaused = false;
                    cond.signal();
                }
                break;
            case '-': //pause
                if (!isPaused) {
                    isPaused = true;
                    cond.signal();
                }
                break;
            case '1': //screen on
                isScreenOff = isPaused = false;
                cond.signal();
                break;
            case '0': //screen off
                isScreenOff = isPaused = true;
                cond.signal();
                break;
            }
        } //end of for(;;)

        LOG("close cmd connection");
        close(connection_fd);
    }
    return 0;
}

static int touch_dev_fd = -1;

static void* thread_touch_socket_server(void* thd_param) {
    int socket_server_fd = (int)thd_param;
    for(;;) {
        LOG("accept");
        int connection_fd = accept(socket_server_fd, NULL, NULL);
        if (connection_fd == -1) {
            LOG("accept err %d", errno);
            continue;
        }

        struct input_event event = {0};
        const int event_core_size = (((char*)&event.value) + sizeof(event.value)) - ((char*)&event.type);
        for(;;) {
            LOG("read touch event");
            if (read(connection_fd, &event.type, event_core_size) != event_core_size) {
                LOG("read err %d", errno);
                break;
            }
            LOGI("handle touch event %d %d %d", event.type, event.code, event.value);
            if (write(touch_dev_fd, &event, sizeof(event)) != sizeof(event)) {
                LOG("write err %d", errno);
                break;
            }
        } //end of for(;;)

        LOG("close touch connection");
        close(connection_fd);
    }
    return 0;
}

static void create_cmd_socket_server() {
    char* socket_name = getenv("ASC_CMD_SOCKET");
    if (socket_name && socket_name[0]) {

        LOG("c s r %s", socket_name);
        int socket_server_fd = socket(AF_LOCAL, SOCK_STREAM, 0);
        if (socket_server_fd == -1) {
            LOG("socket err %d", errno);
            return;
        }

        struct sockaddr_un addr = {0};
        addr.sun_family = AF_LOCAL;
        int namelen = strlen(socket_name);
        if (1/*\0*/+namelen > sizeof(addr.sun_path)) ABORT("socket name too long");
        memcpy(&addr.sun_path[1], socket_name, namelen);
        int addrlen = offsetof(struct sockaddr_un, sun_path) + 1/*\0*/ + namelen;

        LOG("bnd");
        if (bind(socket_server_fd, (struct sockaddr*)&addr, addrlen)) {
            LOG("bind err %d", errno);
            return;
        }

        LOG("lstn");
        if (listen(socket_server_fd, 1)) {
            LOG("listen err %d", errno);
            return;
        }

        LOG("cthd");
        pthread_t thd;
        int err = pthread_create(&thd, NULL, thread_cmd_socket_server, (void*)socket_server_fd);
        if (err) {
            LOG("pthread_create err %d", err);
            return;
        }
    }
}

static void create_touch_socket_server() {
    char* socket_name = getenv("ASC_TOUCH_SOCKET");
    if (socket_name && socket_name[0]) {

        LOG("o t d %s", socket_name);
        touch_dev_fd = open(socket_name, O_WRONLY);
        if (touch_dev_fd==-1) {
            LOG("open err %d", errno);
            return;
        }

        LOG("c s r %s", socket_name);
        int socket_server_fd = socket(AF_LOCAL, SOCK_STREAM, 0);
        if (socket_server_fd == -1) {
            LOG("socket err %d", errno);
            return;
        }

        struct sockaddr_un addr = {0};
        addr.sun_family = AF_LOCAL;
        int namelen = strlen(socket_name);
        if (1/*\0*/+namelen > sizeof(addr.sun_path)) ABORT("socket name too long");
        memcpy(&addr.sun_path[1], socket_name, namelen);
        int addrlen = offsetof(struct sockaddr_un, sun_path) + 1/*\0*/ + namelen;

        LOG("bnd");
        if (bind(socket_server_fd, (struct sockaddr*)&addr, addrlen)) {
            LOG("bind err %d", errno);
            return;
        }

        LOG("lstn");
        if (listen(socket_server_fd, 1)) {
            LOG("listen err %d", errno);
            return;
        }

        LOG("cthd");
        pthread_t thd;
        int err = pthread_create(&thd, NULL, thread_touch_socket_server, (void*)socket_server_fd);
        if (err) {
            LOG("pthread_create err %d", err);
            return;
        }
    }
}

#define ENABLE_RESEND 1

#if ENABLE_RESEND 
    struct timespec origTime = {0};
    struct timespec lastRereadTime = {0};
    static int resend_count = 0;
    #define RESEND_INTERVAL_NS ((int)(1000000000*0.25))
    #define RESEND_COUNT 2
#endif

#define toEvenInt(n) ((int)(ceil(((float)(n))/2)*2))
#define min(a,b) ((a) < (b) ? (a) : (b))
#define max(a,b) ((a) > (b) ? (a) : (b))

static sp<IBinder> __csBinder;
// static sp<ISurfaceComposer> __cs;
static sp<IBinder> mainDisp, virtDisp;
static DisplayInfo mainDispInfo;
static bool internal_w_gt_h = false;
static int capture_w, capture_h, logicalFrameSize;
class MyGraphicBufferProducer;
static MyGraphicBufferProducer* bp;
// static Vector<ComposerState> _emptyComposerStates; //dummy
// static Vector<DisplayState > _displayStates;
// static DisplayState* virtDispState = NULL;
static DisplayState* virtDispState = new DisplayState();
static int TRANS_ID_GET_DISPLAY_INFO = 0;
static int TRANS_ID_SET_DISPLAY_STATE = 0;
#define BPP 4

struct CallbackStep {
    int ind;
    const char* name;
};
static CallbackStep bpSteps[1/*invalid step 0*/+32] = {0};
static int bpStepMax = 0;
static int step_queueBuffer = 0;
static int step_requestBuffer = 0;



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
    step_requestBuffer = bpStepMax;
    INIT_NEXT_CALLBACK_STEP(queueBuffer);
    step_queueBuffer = bpStepMax;
}

static int bpCodeToVirtIndex(uint32_t code) {
    static int diff = -1;
    if (diff == -1)
        diff = getVirtFuncIndex(&IGraphicBufferProducer::requestBuffer)-1/*code*/;
    if (diff <= 0) ABORT("bad rbf vi");
    return code + diff;
}

static int convertOrient(int orient) {
    //orient: 1=90 2=180 3=270
    if (internal_w_gt_h) { //sample device: FUJITSU F-02F 4.2.2
        if (capture_w < capture_h) //normal case: draw in portrait canvas
            return (orient+1)%4;
        else //special case: draw in landscape canvas
            return orient;
    } else { //this is for normal device
        if (capture_w < capture_h) //normal case: draw in portrait canvas
            return orient;
        else //special case: draw in landscape canvas
            return (orient+3)%4;
    }
}

#if (ANDROID_VER>=500)
    #define MIN_DISP_INFO_HEAD_SIZE 2*sizeof(int)  //vector head
#else
    #define MIN_DISP_INFO_HEAD_SIZE 0
#endif
#define MIN_DISP_INFO_SIZE  (MIN_DISP_INFO_HEAD_SIZE + ((size_t)&(((DisplayInfo*)NULL)->reserved)))

static int getOrient() {
    LOG("r go");
    // status_t err = __cs->getDisplayInfo(mainDisp, &mainDispInfo);

    Parcel data, reply;
    data.writeInterfaceToken(ISurfaceComposer::descriptor);
    data.writeStrongBinder(mainDisp);
    status_t err = __csBinder->transact(TRANS_ID_GET_DISPLAY_INFO, data, &reply);
    if (err) ABORT("r go e %d", err);
    if (reply.dataSize() < MIN_DISP_INFO_SIZE) ABORT("r go s t l");
    DisplayInfo* info = (DisplayInfo*)(reply.data() + MIN_DISP_INFO_HEAD_SIZE);
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
    void* mBufferInput_flattened_buf;
    size_t mBufferInput_flattened_size;
    int* mBufferInput_flattened_fds;
    size_t mBufferInput_flattened_fd_count;

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
        mBufferInput_flattened_buf = NULL;
        mBufferInput_flattened_size = 0;
        mBufferInput_flattened_fds = NULL;
        mBufferInput_flattened_fd_count = 0;
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
        LOGI("q %d i %p o %p sq %lld", slot, &input, output, ++mSeq);
        size_t _fd_count = input.getFdCount();
        size_t _fl_size = input.getFlattenedSize();
        LOG("_q flsz %d fdc %d", _fl_size, _fd_count);
        if (_fd_count > 0) {
            if (mBufferInput_flattened_size < _fl_size || mBufferInput_flattened_buf==NULL) {
                mBufferInput_flattened_buf = realloc(mBufferInput_flattened_buf, _fl_size);
                mBufferInput_flattened_size = _fl_size;
            }
            if (mBufferInput_flattened_fd_count < _fd_count || mBufferInput_flattened_fds==NULL) {
                mBufferInput_flattened_fds = (int*)realloc(mBufferInput_flattened_fds, _fd_count*sizeof(int));
                mBufferInput_flattened_fd_count = _fd_count;
            }
        }

        if (slot != 0) ABORT("q %d n 0", slot);

        if (output) {
            LOG("_q so");
            output->width = mWidth;
            output->height = mHeight;
            output->transformHint = 0;
            output->numPendingBuffers = 0;
        }

        int orient = getOrient();

        AutoMutex autoLock(mutex);
        if (mBufferInput_flattened_fd_count > 0 && mBufferInput_flattened_buf !=NULL && mBufferInput_flattened_fds != NULL) {
            void* _fl_buf = mBufferInput_flattened_buf;
            int* _fds = mBufferInput_flattened_fds;
            LOG("_q fl");
            status_t err = input.flatten(_fl_buf, _fl_size, _fds, _fd_count); //!! //maybe change arguments after flattened
            LOG("_q fl r %d fd %d", err, mBufferInput_flattened_fds[0]);
            if (!err) {
                mFence = sp<Fence>(new Fence(dup(mBufferInput_flattened_fds[0])));
            }
        }

        if (convertOrient(orient) != virtDispState->orientation) {
            setVirtDispOrient(orient);
        } else {
            mHaveData = true;
            #if ENABLE_RESEND
                clock_gettime(CLOCK_MONOTONIC, &origTime);
                resend_count = 0;
            #endif
            if ( isPaused ) {
                //skip
            } else {
                cond.signal(); //anyway wake up main or resend thread
            }
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
        // analyse time sequence, determin each code
        static int bpStepOfCode[32] = {0/*invalid step*/};
        if (code <= 0 || code >= sizeof(bpStepOfCode)/sizeof(bpStepOfCode[0])) {
            LOG("t. %d ds %d c b", code, data.dataSize());
            return reply->writeInt32(-ENOSYS);
        }
        if (bpStepOfCode[code] < 0) {
            LOG("t. %d ds %d sk", code, data.dataSize());
            return reply->writeInt32(-ENOSYS);
        }
        if (bpStepOfCode[code] == 0) { //if not registered
            LOGI("t %d ds %d s?", code, data.dataSize());
            static int step = 1;
            if(step > bpStepMax) {
                bpStepOfCode[code] = -1;
                LOGI(".t %d ds %d s t m", code, data.dataSize());
                return reply->writeInt32(-ENOSYS);
            }
            if (step==step_requestBuffer && code != 1) {
                ABORT(".t %d ds %d c ! 1", code, data.dataSize());
            }
            if (step==step_queueBuffer && data.dataSize() < 128) {
                bpStepOfCode[code] = -1;
                LOGI(".t %d ds %d s t s", code, data.dataSize());
                return reply->writeInt32(-ENOSYS);
            }
            LOGI("rg %d st%d", code, step);
            bpStepOfCode[code] = step;

            int ind = bpCodeToVirtIndex(code);
            if (ind != bpSteps[step].ind) {
                //////////////////////////////////////////////////////////////////
                // Adjust some virtual function's position
                //////////////////////////////////////////////////////////////////
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

            step++;
        } // end of !bpStepOfCode[code])
        else {
            LOG("t %d ds %d s %d", code, data.dataSize(), bpStepOfCode[code]);
        }

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
            LOG("sn tr c %d", code);
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

static void asc_init(ASC* asc) {
    status_t err;
    chkDev();
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
        DisplayInfo* info = (DisplayInfo*)(reply.data() + MIN_DISP_INFO_HEAD_SIZE);
        if (info->w != mainDispInfo.w || info->h != mainDispInfo.h) ABORT("r gd abn. w %d h %d", info->w, info->h);
        mainDispInfo.orientation = info->orientation;
    }
    LOG(".r gd w %d h %d o %d", mainDispInfo.w, mainDispInfo.h, mainDispInfo.orientation);

    if (mainDispInfo.w > mainDispInfo.h) {
        LOGI("i w gt h");
        int h = mainDispInfo.h;
        mainDispInfo.h = mainDispInfo.w;
        mainDispInfo.w = h;
        internal_w_gt_h = true;
    }

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
    LOG("c c r w %d h %d ar", capture_w, capture_h);


    if (isatty(STDOUT_FILENO)) {
        LOG("iaty");
        struct termios term;
        if (tcgetattr(STDOUT_FILENO, &term)) ABORT_ERRNO("tga");
        LOG("mkr");
        cfmakeraw(&term);
        LOG("tsa");
        if (tcsetattr(STDOUT_FILENO, TCSANOW, &term)) ABORT_ERRNO("tsa");
    }

    create_cmd_socket_server();
    create_touch_socket_server();
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
        if (!isFirstTime && !bp->mHaveData && !isPaused && resend_count < RESEND_COUNT) {
            struct timespec now;
            clock_gettime(CLOCK_MONOTONIC, &now);
            if ( (now.tv_sec-origTime.tv_sec)*1000000000 + (now.tv_nsec-origTime.tv_nsec) >= RESEND_INTERVAL_NS*RESEND_COUNT) {
                if (resend_count == 0) {
                    LOG("rt pr d rs lst sq %lld t c c...", seq);
                    resend_count = RESEND_COUNT;
                    return; //this cause caller reuse previous buffer pointer which contents maybe has been changed
                }
            } else {
                struct timespec untilTime = (resend_count==0) ? origTime : lastRereadTime;
                if ((untilTime.tv_nsec += RESEND_INTERVAL_NS) >= 1000000000) {
                    untilTime.tv_nsec -= 1000000000;
                    untilTime.tv_sec++;
                }
                LOG("dl mx %d ms 4 ru d", ((untilTime.tv_sec-now.tv_sec)*1000000000 + (untilTime.tv_nsec-now.tv_nsec))/1000000);
                if ((err=cond.waitAbsMono(mutex, &untilTime)) == -ETIMEDOUT) {
                    LOG("rt pr d rs sq %lld  t c c...", seq);
                    resend_count++;
                    #if RESEND_COUNT > 1
                        clock_gettime(CLOCK_MONOTONIC, &lastRereadTime);
                    #endif
                    return; //this cause caller reuse previous buffer pointer which contents maybe has been changed
                }
            }
        }
    #endif

    for(;;) {
        if (isPaused && !isFirstTime) {
            if (blackscreen==NULL) {
                asc->data = blackscreen = (char*)malloc(asc->size);
                if (!blackscreen) ABORT("oom");
                memset(blackscreen,  isScreenOff ? 0 : 0x40, asc->size);
                LOGI("use blackscreen");
                return;
            }
            else {
                if (blackscreen_extra_count++ < 3) { //very strange!
                    asc->data = blackscreen;
                    LOG("use blackscreen");
                    return;
                }
                blackscreen_extra_count = 0;
                free(blackscreen);
                blackscreen = NULL;

                do {
                    LOGI("wait for resume");
                    cond.wait(mutex);
                } while ( isPaused );

                bp->mHaveData = true; //force send image
                #if ENABLE_RESEND
                    clock_gettime(CLOCK_MONOTONIC, &origTime);
                    resend_count = 0;
                #endif
            }
        } //end of if (isPaused)

        if ( bp->mHaveData )
            break;
        LOG("w 4 d");
        cond.wait(mutex);
    }
    LOG("g n d e");
    bp->mHaveData = false;
    asc->data = bp->mGBufData;

    if (bp->mFence && bp->mFence->isValid()) {
         LOG("w 4 f");
         bp->mFence->wait(-1);
    }

    if (isFirstTime) {
        asc->w = bp->mInternalWidth;
        asc->h = bp->mHeight;
        strcpy(asc->pixfmtName, bp->mFormat==1?"rgb0":"bgr0");
        asc->size = bp->mInternalWidth*bp->mHeight*BPP;
        if (isPaused) {
            asc->data = blackscreen = (char*)calloc(asc->size, 1);
            if (!blackscreen) ABORT("oom");
            memset(blackscreen,  isScreenOff ? 0 : 0x40, asc->size);
            LOGI("use blackscreen");
        }
    }
    
    seq++;
    LOGI("r d sq %lld", seq);

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

