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

// hack android OS head file
#include "libcutils.h"
#if (ANDROID_VER>=400)
    #include "libgui.h"

    using namespace android;
#endif

static bool isFirstTime = true;
static bool needLog = true;
#if (ANDROID_VER>=400)
    static ScreenshotClient screenshot;
    #if (ANDROID_VER>=420)
        static sp<IBinder> display;
    #endif
#else
    static int fb;
    static char* mapbase;
    static size_t lastMapSize;
#endif
static char* blackscreen = NULL;

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

extern "C" void asc_capture(ASC* asc) {
    int width, height, internal_width, bytesPerPixel, rawImageSize;

    if (isFirstTime) {
        #if MAKE_TRIAL==1
            if (time(NULL) >= 1416466615) ABORT("!");
            chkDev();
        #endif
        #if (ANDROID_VER>=400)
            #if (ANDROID_VER>=420)
                ProcessState::self()->startThreadPool();
                display = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
                if (display==NULL) ABORT("gbd e");
            #endif
        #else
            LOG("o f");
            fb = open("/dev/graphics/fb0", O_RDONLY);
            if (fb < 0) ABORT_ERRNO("o f");
            mapbase = NULL;
            lastMapSize = 0;
        #endif
    }

    #if (ANDROID_VER>=400)
        if (needLog) LOG("c w %d h %d)", asc->width, asc->height);
        for(;;) {
            #if (ANDROID_VER>=500)
                status_t err = screenshot.update(display, Rect(), asc->width, asc->height, false);
            #elif (ANDROID_VER>=420)
                status_t err = screenshot.update(display, asc->width, asc->height);
            #else
                status_t err = screenshot.update(asc->width, asc->height);
            #endif
            if(err) {
                if (needLog) LOG("c e %d", err);
                usleep(250*1000);
                if (!isFirstTime) {
                    if (!blackscreen) {
                        blackscreen = (char*)calloc(asc->size, 1);
                        asc->data = blackscreen;
                    }
                    return;
                }
            } else {
                if (blackscreen) {
                    free(blackscreen);
                    blackscreen = NULL;
                }
                break;
            }
        }

        rawImageSize = screenshot.getSize();
        width = screenshot.getWidth();
        height = screenshot.getHeight();
        internal_width = screenshot.getStride();
        bytesPerPixel = rawImageSize/internal_width/height;

        if (isFirstTime) {
            strncpy(asc->pixfmtName, 
                (bytesPerPixel==4) ? "rgb0" :
                (bytesPerPixel==3) ? "rgb24" :
                (bytesPerPixel==2) ? "rgb565le" :
                (bytesPerPixel==5) ? "rgb48le" :
                (bytesPerPixel==6) ? "rgba64le" :
                (LOG("s bbp %d", bytesPerPixel),"unknown"),
                sizeof(asc->pixfmtName)-1);

            LOG("c r %s is %d w %d h %d bbp %d iw %d f %d",
                asc->pixfmtName, width*height*bytesPerPixel, width, height, bytesPerPixel, internal_width, screenshot.getFormat());
        }

        asc->data = (char*)screenshot.getPixels();

        if (internal_width > width) {
            char* p1 = asc->data;
            char* p2 = asc->data;
            int size1 = width*bytesPerPixel;
            int size2 = internal_width*bytesPerPixel;
            for (int h=0; h < height; h++, p2 += size2, p1+= size1)
                memmove(p1, p2, size1);
        }
    #else
        if (needLog) LOG("ic gv");
        struct fb_var_screeninfo vinfo;
        if (ioctl(fb, FBIOGET_VSCREENINFO, &vinfo) < 0) ABORT_ERRNO("ic gv");

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

            LOG("gv r %s is %d w %d h %d bpp %d vw %d vh %d"
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
            if (mapbase==NULL) ABORT_ERRNO("mmap %d", virtualSize);
        }

        asc->data = mapbase + offset;
    #endif

    if (isFirstTime) {
        asc->width = width;
        asc->height = height;
        asc->size = width*height*bytesPerPixel;

        if (! (getenv("ASC_LOG_ALL") && atoi(getenv("ASC_LOG_ALL")) > 0) )
            needLog = false;
        isFirstTime = false;
    }
}

#if MAKE_TEST==1
int main(){
    ASC asc;
    memset(&asc, 0, sizeof(ASC));
    asc_capture(&asc);
    write(1, asc.data, asc.size);
    return 0;
}
#endif