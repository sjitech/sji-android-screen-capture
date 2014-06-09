/*
 * TARGET_JB:  ver >= 4.1.2
 * TARGET_ICS: ver >= 4.0
 * other: ver < 4.0
 */
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

#define FRAME_BUFFER_DEV "/dev/graphics/fb0"

#define LOG(fmt, arg...)      _LOG("[get-raw-image]" fmt "\n", ##arg)
#define LOGERR(fmt, arg...)   _LOG("[get-raw-image][Error%d(%s)]" fmt "\n", errno, strerror(errno), ##arg)
#define ABORT(fmt, arg...)  ({_LOG("[get-raw-image][Error%d(%s)]" fmt ". Now exit\n", errno, strerror(errno), ##arg); exit(1);})

void _LOG(const char* format, ...) {
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
    sprintf(buf, "%02d/%02d %02d:%02d:%02d.%06d",
        st->tm_mon+1,
        st->tm_mday,
        st->tm_hour,
        st->tm_min,
        st->tm_sec,
        (int)(mms%1000000)
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


static void on_SIGPIPE(int signum) {
    LOG("pipe peer ended first, no problem");
    exit(1);
}

// hack android OS head file
#if defined(TARGET_ICS) || defined(TARGET_JB)
namespace android {

template <typename T> class sp {
public:
    union{
        T* m_ptr;
        char data[64];
    };
};

class IBinder;

class ScreenshotClient {
    /*
    sp<IMemoryHeap> mHeap;
    uint32_t mWidth;
    uint32_t mHeight;
    PixelFormat mFormat;
    */
    char data[1024];
public:
    ScreenshotClient();

#if defined(TARGET_ICS)
    // frees the previous screenshot and capture a new one
    int32_t update();
#endif
#if defined(TARGET_JB)
    // frees the previous screenshot and capture a new one
    int32_t update(const sp<IBinder>& display);
#endif
    // pixels are valid until this object is freed or
    // release() or update() is called
    void const* getPixels() const;

    uint32_t getWidth() const;
    uint32_t getHeight() const;
    int32_t getFormat() const;
    // size of allocated memory in bytes
    size_t getSize() const;
};

#if defined(TARGET_JB)
class SurfaceComposerClient {
public:
    //! Get the token for the existing default displays.
    //! Possible values for id are eDisplayIdMain and eDisplayIdHdmi.
    static sp<IBinder> getBuiltInDisplay(int32_t id);
};
#endif
}

using android::ScreenshotClient;
using android::sp;
using android::IBinder;
#if defined(TARGET_JB)
using android::SurfaceComposerClient;
#endif

#endif

int main(int argc, char** argv) {
    LOG("start. pid %d", getpid());
    int64_t interval_mms = -1;
    bool isGetFormat = false;
    bool forceUseFbFormat = false;
    const char* tmps;
    int width, height, bytesPerPixel;

    //for fb0
    int fb = -1;
    char* mapbase = NULL;
    size_t lastMapSize = 0;

    if (argc>1) {
        double fps = atof(argv[1]);
        if (fps==0) {
            //
        }
        else {
            interval_mms = ((double)1000000)/fps;
            LOG("use fps=%.3lf (interval=%.3lfms)", fps, (double)interval_mms/1000);
        }
    } else {
        isGetFormat = true;
    }

    if (isGetFormat && (tmps=getenv("forceUseFbFormat")) && 0==strcmp(tmps, "forceUseFbFormat")) {
        LOG("forceUseFbFormat");
        forceUseFbFormat = true;
    }

#if defined(TARGET_JB) || defined(TARGET_ICS)
    LOG("call ScreenshotClient init");
    ScreenshotClient screenshot;
#endif

#if defined(TARGET_JB)
    LOG("call SurfaceComposerClient::getBuiltInDisplay");
    sp<IBinder> display = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
    if (display.m_ptr==NULL)
        LOGERR("failed to getBuiltInDisplay. So use fb0");
#endif

    //LOG(isGetFormat ? "capture once" : "start capture");
    int64_t count_start_mms = microSecondOfNow();
    int64_t until_mms = count_start_mms + interval_mms;

    for (int count=1; ;count++, until_mms += interval_mms) {

        char* rawImageData;
        size_t rawImageSize;

#if defined(TARGET_JB) || defined(TARGET_ICS)
        bool surfaceOK = false;
        uint32_t status;
#endif

#if defined(TARGET_JB)
        if (!forceUseFbFormat) {
            if (display.m_ptr != NULL) {
                if (count==1) LOG("call ScreenshotClient.update(mainDisplay)");
                status = screenshot.update(display);
                surfaceOK = (status == 0);
                if (!surfaceOK)
                    LOG("Error: failed to ScreenshotClient.update(mainDisplay). Result:%d. So use fb0 alternatively, maybe not useful", status);
            }
        }
#endif
#if defined(TARGET_ICS)
        if (!forceUseFbFormat) {
            if (count==1) LOG("call ScreenshotClient.update()");
            status = screenshot.update();
            surfaceOK = (status == 0);
            if (!surfaceOK)
                LOG("Error: failed to ScreenshotClient.update(). Result:%d. So use fb0 alternatively, maybe not useful", status);
        }
#endif
#if defined(TARGET_JB) || defined(TARGET_ICS)
        if (surfaceOK) {
            rawImageData = (char*)screenshot.getPixels();
            rawImageSize = screenshot.getSize();
            width = screenshot.getWidth();
            height = screenshot.getHeight();
            bytesPerPixel = rawImageSize/width/height;
            int fmt = screenshot.getFormat();
            if (count==1) {
                LOG("ScreenshotClient.update result: imageSize:%d w:%d h:%d bytesPerPixel:%d fmt:%d",
                 rawImageSize, width, height, bytesPerPixel, fmt);
            }

            if (isGetFormat) {
                printf("-s %dx%d -pix_fmt %s\n", width, height,
                    (bytesPerPixel==4) ? "rgb0" :
                    (bytesPerPixel==3) ? "rgb24" :
                    (bytesPerPixel==2) ? "rgb565le" :
                    (bytesPerPixel==5) ? "rgb48le" :
                    (bytesPerPixel==6) ? "rgba64le" :
                    (LOG("strange bytesPerPixel:%d", bytesPerPixel),"unknown"));
                LOG("end");
                return 0;
            }
        } else
#endif
        {
            if (fb < 0) {
                fb = open(FRAME_BUFFER_DEV, O_RDONLY);
                if (fb < 0)
                    ABORT("open fb0");
            }

            struct fb_var_screeninfo vinfo;
            if (ioctl(fb, FBIOGET_VSCREENINFO, &vinfo) < 0)
                ABORT("ioctl fb0");

            width = vinfo.xres;
            height = vinfo.yres;
            bytesPerPixel = vinfo.bits_per_pixel/8;
            rawImageSize = (width*height) * bytesPerPixel;

            if (count==1) {
                LOG("FBIOGET_VSCREENINFO result: imageSize:%d w:%d h:%d bytesPerPixel:%d virtualW:%d virtualH:%d"
                    " bits:%d"
                    " R:(offset:%d length:%d msb_right:%d)"
                    " G:(offset:%d length:%d msb_right:%d)"
                    " B:(offset:%d length:%d msb_right:%d)"
                    " A:(offset:%d length:%d msb_right:%d)"
                    " grayscale:%d nonstd:%d rotate:%d",
                    rawImageSize, width, height, bytesPerPixel, vinfo.xres_virtual, vinfo.yres_virtual
                    ,vinfo.bits_per_pixel
                    ,vinfo.red.offset, vinfo.red.length, vinfo.red.msb_right
                    ,vinfo.green.offset, vinfo.green.length, vinfo.green.msb_right
                    ,vinfo.blue.offset, vinfo.blue.length, vinfo.blue.msb_right
                    ,vinfo.transp.offset, vinfo.transp.length, vinfo.transp.msb_right
                    ,vinfo.grayscale, vinfo.nonstd, vinfo.rotate
                    );
            }

            if (isGetFormat) {
                printf("-s %dx%d -pix_fmt %s\n", width, height,
                    (vinfo.bits_per_pixel==32&&vinfo.red.offset==0) ? "rgb0" :
                    (vinfo.bits_per_pixel==32&&vinfo.red.offset!=0) ? "bgr0" :
                    (vinfo.bits_per_pixel==24&&vinfo.red.offset==0) ? "rgb24" :
                    (vinfo.bits_per_pixel==24&&vinfo.red.offset!=0) ? "bgr24" :
                    (vinfo.bits_per_pixel==16&&vinfo.red.offset==0) ? "rgb565le" :
                    (vinfo.bits_per_pixel==16&&vinfo.red.offset!=0) ? "bgr565le" :
                    (vinfo.bits_per_pixel==48&&vinfo.red.offset==0) ? "rgb48le" :
                    (vinfo.bits_per_pixel==48&&vinfo.red.offset!=0) ? "bgr48le" :
                    (vinfo.bits_per_pixel==64&&vinfo.red.offset==0) ? "rgba64le" :
                    (vinfo.bits_per_pixel==64&&vinfo.red.offset!=0) ? "bgra64le" :
                    (LOG("strange bits_per_pixel:%d", vinfo.bits_per_pixel),"unknown"));
                LOG("end");
                return 0;
            }
            else {
                uint32_t offset =  (vinfo.xoffset + vinfo.yoffset*width) *bytesPerPixel;
                int virtualSize = vinfo.xres_virtual*vinfo.yres_virtual*bytesPerPixel;
                if (offset+rawImageSize > virtualSize) {
                    LOG("Strange! offset:%d+rawImageSize:%d > virtualSize:%d", offset, rawImageSize, virtualSize);
                    virtualSize = offset+rawImageSize;
                }

                if (virtualSize > lastMapSize) {
                    if (mapbase) {
                        LOG("remap due to virtualSize %d is bigger than previous %d", virtualSize, lastMapSize);
                        munmap(mapbase, lastMapSize);
                        mapbase = NULL;
                    }
                    lastMapSize = virtualSize;
                }

                if (mapbase==NULL) {
                    mapbase = (char*)mmap(0, virtualSize, PROT_READ, MAP_PRIVATE, fb, 0);
                    if (mapbase==NULL)
                        ABORT("mmap %d", virtualSize);
                }


                rawImageData = mapbase + offset;
            }
        }

        if (count==1) { //when first time, set SIGPIPE handler to default (terminate)
            signal(SIGPIPE, on_SIGPIPE); //this is very important!!! If not set, write will be very slow if data is too big
            LOG("rawImageSize:%d", rawImageSize);
        }

        #define MAX_WRITE_SIZE (32*1024*1024)
//        #define MAX_WRITE_SIZE (4*1024*1024)
        int rest = rawImageSize;
        int callCount = 0;
        while (rest > 0) {
            int request = rest <= MAX_WRITE_SIZE ? rest : MAX_WRITE_SIZE;
            if (callCount > 0 ||request < rest) LOG("data is too big so try to write %d of rest %d", request, rest);
            int bytesWritten = write(STDOUT_FILENO, rawImageData+(rawImageSize-rest), request);
            if (bytesWritten < 0) {
                ABORT("write() requested:%d", request);
            } else if (bytesWritten < request) {
                LOGERR("write() result:%d < requested:%d. Continue writing rest data", bytesWritten, request);
            } else {
//                if (callCount > 0) LOG("write %d OK", request);
            }
            rest -= bytesWritten;
            callCount++;
        }
        if (callCount > 1) LOG("write() finished. total:%d", rawImageSize);

        if (interval_mms==-1) {
            LOG("stop due to fps argument is 0");
            close(STDOUT_FILENO); //let pipe peer known end, maybe unnecessary
            exit(0);
        }
        else {
            if (count==1) LOG("continue capturing......");
        }

        int64_t now_mms = microSecondOfNow();
        int64_t diff_mms = until_mms - now_mms;
        if (diff_mms > 0) {
            usleep(diff_mms);
            now_mms += diff_mms;
        }

        /*
        //show statistics at every about 10 seconds
        diff_mms = now_mms-count_start_mms;
        if (diff_mms >= 10*1000000) {
            //LOG("count: %d now-count_start_ms: %lld", count, diff_mms);
            LOG("raw fps: %.2lf   ", ((double)count) / (((double)diff_mms)/1000000));
            count_start_mms = now_mms;
            count = 0;
        }
        */
    }

    return 0;
}
