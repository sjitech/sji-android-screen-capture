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

struct ASC_PRIV_DATA;
struct ASC {
    ASC_PRIV_DATA* priv_data;
    char* data;
    int size;
    int width;
    int height;
    char pixfmtName[32];
};

#define LOG(fmt, arg...)           _LOG(fmt, ##arg)
#define ABORT(fmt, arg...)       ({_LOG(fmt ". Now exit", ##arg); exit(0);})
#define LOGERR(fmt, arg...)        _LOG("[errno %d(%s)]" fmt, errno, strerror(errno), ##arg)
#define ABORT_ERRNO(fmt, arg...) ({_LOG("[errno %d(%s)]" fmt ". Now exit\n", errno, strerror(errno), ##arg); exit(0);})

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

// hack android OS head file
#include "libcutils.h"
#if (ANDROID_VER>=400)
    #include "libgui.h"

    using namespace android;
#endif

struct ASC_PRIV_DATA {
    #if (ANDROID_VER>=400)
        ScreenshotClient screenshot;
        #if (ANDROID_VER>=420)
            sp<IBinder> display;
        #endif
    #else
        int fb;
        char* mapbase;
        size_t lastMapSize;
    #endif
};

#if MAKE_TEST
    static
#else
    extern "C"
#endif
void asc_capture(ASC* asc) {
    int width, height, internal_width, bytesPerPixel;
    size_t rawImageSize;
    static bool needLogAll = false;

    ASC_PRIV_DATA * _this = asc->priv_data;
    bool isFirstTime = (_this==NULL);

    if (isFirstTime) {
        _this = asc->priv_data = new ASC_PRIV_DATA();
        needLogAll = (getenv("ASC_LOG_ALL") && atoi(getenv("ASC_LOG_ALL")) > 0);

        #if (ANDROID_VER>=400)
            #if (ANDROID_VER>=420)
                ProcessState::self()->startThreadPool();
                _this->display = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
                if (_this->display==NULL) ABORT("getBuiltInDisplay error");
            #endif
        #else
            LOG("open fb");
            _this->fb = open("/dev/graphics/fb0", O_RDONLY);
            if (_this->fb < 0) ABORT_ERRNO("open fb0");
            _this->mapbase = NULL;
            _this->lastMapSize = 0;
        #endif
    }

    #if (ANDROID_VER>=400)
        if (isFirstTime||needLogAll) LOG("capture(w:%d h:%d)", asc->width, asc->height);
        for(;;) {
            #if (ANDROID_VER>=420)
                status_t err = _this->screenshot.update(_this->display, asc->width, asc->height);
            #else
                status_t err = _this->screenshot.update(asc->width, asc->height);
            #endif
            if(err) {
                LOG("capture err:%d", err);
                usleep(100*1000);
            } else {
                break;
            }
        }

        rawImageSize = _this->screenshot.getSize();
        width = _this->screenshot.getWidth();
        height = _this->screenshot.getHeight();
        internal_width = _this->screenshot.getStride();
        bytesPerPixel = rawImageSize/internal_width/height;

        if (isFirstTime) {
            strncpy(asc->pixfmtName, 
                (bytesPerPixel==4) ? "rgb0" :
                (bytesPerPixel==3) ? "rgb24" :
                (bytesPerPixel==2) ? "rgb565le" :
                (bytesPerPixel==5) ? "rgb48le" :
                (bytesPerPixel==6) ? "rgba64le" :
                (LOG("strange bytesPerPixel:%d", bytesPerPixel),"unknown"),
                sizeof(asc->pixfmtName)-1);

            LOG("capture result: %s imageSize:%d(w:%d h:%d bytesPerPixel:%d) internalW:%d fmt:%d",
                asc->pixfmtName, width*height*bytesPerPixel, width, height, bytesPerPixel, internal_width, _this->screenshot.getFormat());
        }

        asc->data = (char*)_this->screenshot.getPixels();

        if (internal_width > width) {
            char* p1 = asc->data;
            char* p2 = asc->data;
            int size1 = width*bytesPerPixel;
            int size2 = internal_width*bytesPerPixel;
            for (int h=0; h < height; h++, p2 += size2, p1+= size1)
                memmove(p1, p2, size1);
        }
    #else
        if (isFirstTime||needLogAll) LOG("ioctl FBIOGET_VSCREENINFO");
        struct fb_var_screeninfo vinfo;
        if (ioctl(_this->fb, FBIOGET_VSCREENINFO, &vinfo) < 0) ABORT_ERRNO("ioctl fb0");

        width = vinfo.xres;
        height = vinfo.yres;
        internal_width = width;
        bytesPerPixel = vinfo.bits_per_pixel/8;
        rawImageSize = (width*height) * bytesPerPixel;

        if (isFirstTime) {
            strncpy(asc->pixfmtName, 
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
                (LOG("strange bits_per_pixel:%d", vinfo.bits_per_pixel),"unknown"),
                sizeof(asc->pixfmtName)-1);

            LOG("FBIOGET_VSCREENINFO result: %s imageSize:%d(w:%d h:%d bytesPerPixel:%d) virtualW:%d virtualH:%d"
                " bits:%d"
                " R:(offset:%d length:%d msb_right:%d)"
                " G:(offset:%d length:%d msb_right:%d)"
                " B:(offset:%d length:%d msb_right:%d)"
                " A:(offset:%d length:%d msb_right:%d)"
                " grayscale:%d nonstd:%d rotate:%d",
                asc->pixfmtName, rawImageSize, width, height, bytesPerPixel, vinfo.xres_virtual, vinfo.yres_virtual
                ,vinfo.bits_per_pixel
                ,vinfo.red.offset, vinfo.red.length, vinfo.red.msb_right
                ,vinfo.green.offset, vinfo.green.length, vinfo.green.msb_right
                ,vinfo.blue.offset, vinfo.blue.length, vinfo.blue.msb_right
                ,vinfo.transp.offset, vinfo.transp.length, vinfo.transp.msb_right
                ,vinfo.grayscale, vinfo.nonstd, vinfo.rotate );
        }

        uint32_t offset =  (vinfo.xoffset + vinfo.yoffset*width) *bytesPerPixel;
        int virtualSize = vinfo.xres_virtual*vinfo.yres_virtual*bytesPerPixel;
        if (offset+rawImageSize > virtualSize) {
            LOG("Strange! offset:%d+rawImageSize:%d > virtualSize:%d", offset, rawImageSize, virtualSize);
            virtualSize = offset+rawImageSize;
        }

        if (virtualSize > _this->lastMapSize) {
            if (_this->mapbase) {
                LOG("remap due to virtualSize %d is bigger than previous %d", virtualSize, _this->lastMapSize);
                munmap(_this->mapbase, _this->lastMapSize);
                _this->mapbase = NULL;
            }
            _this->lastMapSize = virtualSize;
        }

        if (_this->mapbase==NULL) {
            _this->mapbase = (char*)mmap(0, virtualSize, PROT_READ, MAP_PRIVATE, _this->fb, 0);
            if (_this->mapbase==NULL) ABORT_ERRNO("mmap %d", virtualSize);
        }

        asc->data = _this->mapbase + offset;
    #endif

    if (isFirstTime) {
        asc->width = width;
        asc->height = height;
        asc->size = width*height*bytesPerPixel;
    }
}

#if MAKE_TEST
int main(){
    ASC asc;
    memset(&asc, 0, sizeof(ASC));
    asc_capture(&asc);
    write(1, asc.data, asc.size);
    return 0;
}
#endif