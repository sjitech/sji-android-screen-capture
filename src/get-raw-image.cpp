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

#define FRAME_BUFFER_DEV "/dev/graphics/fb0"

#define LOG(fmt, arg...) fprintf(stderr, "[get-raw-image]" fmt "\n", ##arg)

void error(const char *msg, ...) {
    va_list vl;
    va_start(vl, msg);
    verr(1, msg, vl); //exit(1)
    va_end(vl);
}

static int64_t microSecondOfNow() {
    struct timeval t;
    gettimeofday(&t, NULL);
    return ((int64_t) t.tv_sec) * (1000 * 1000) + t.tv_usec;
}


// hack android OS head file
#if defined(TARGET_ICS) || defined(TARGET_JB)
namespace android {

template <typename T> class sp {
public:
	union{
		T* m_ptr;
		char data[32];
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
    char data[64];
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
    LOG("start");
	int64_t interval_mms = -1;
	bool isGetFormat = false;

	if (argc>1) {
		double fps = atof(argv[1]);
		if (fps==0) {
			//error("wrong parameter for fps(frames_per_second)");
		}
		else {
			interval_mms = ((double)1000000)/fps;
			LOG("use fps=%.3lf (interval=%.3lfms)", fps, (double)interval_mms/1000);
		}
	} else {
		isGetFormat = true;
	}

	int fb = -1;
	char* mapbase = NULL;

#if defined(TARGET_JB) || defined(TARGET_ICS)
	LOG("call ScreenshotClient init");
    ScreenshotClient screenshot;
#endif

#if defined(TARGET_JB)
	LOG("call SurfaceComposerClient::getBuiltInDisplay");
    sp<IBinder> display = SurfaceComposerClient::getBuiltInDisplay(0 /*1 is hdmi*/);
    if (display.m_ptr==NULL)
		LOG("error getBuiltInDisplay");
#endif

	int errcount = 0;
	//LOG(isGetFormat ? "capture once" : "start capture");
	int64_t count_start_mms = microSecondOfNow();
	int64_t until_mms = count_start_mms + interval_mms;
	
	for (int count=1; ;count++, until_mms += interval_mms) {

        char* rawImageData;
        size_t rawImageSize;

#if defined(TARGET_JB) || defined(TARGET_ICS)
		bool surfaceOK = false;
#endif

#if defined(TARGET_JB)
		if (display.m_ptr != NULL) {
			if (count==1) LOG("call ScreenshotClient.update(display)");
			surfaceOK = (screenshot.update(display) == 0);
		}
#endif
#if defined(TARGET_ICS)
		if (count==1) LOG("call ScreenshotClient.update()");
		surfaceOK = (screenshot.update() == 0);
#endif
#if defined(TARGET_JB) || defined(TARGET_ICS)
		if (!surfaceOK) if (++errcount<10||errcount%100==0) LOG("error ScreenshotClient.update. So use fb0");
		if (surfaceOK) {
			rawImageData = (char*)screenshot.getPixels();
			rawImageSize = screenshot.getSize();
			
			if (isGetFormat) {
				int width = screenshot.getWidth();
				int height = screenshot.getHeight();
				int bytesPerPixel = rawImageSize/width/height;
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
				if (fb < 0) {
					if (++errcount<10) error("open");
					if (errcount%100==0) errcount=0;
				}
			}

			struct fb_var_screeninfo vinfo;
			if (ioctl(fb, FBIOGET_VSCREENINFO, &vinfo) != 0) {
				if (++errcount<10) error("ioctl");
				if (errcount%100==0) errcount=0;
			}

			if (isGetFormat) {
				printf("-s %dx%d -pix_fmt %s\n", vinfo.xres, vinfo.yres, 
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
				int bytesPerPixel = vinfo.bits_per_pixel/8;
				
				if (mapbase==NULL) {
					int virtualSize = vinfo.xres_virtual*vinfo.yres_virtual*bytesPerPixel;
					mapbase = (char*)mmap(0, virtualSize, PROT_READ, MAP_PRIVATE, fb, 0);
					if (mapbase==NULL) {
						if (++errcount<10) error("mmap %d", virtualSize);
						if (errcount%100==0) errcount=0;
					}
				}

				uint32_t offset =  (vinfo.xoffset + vinfo.yoffset*vinfo.xres) *bytesPerPixel;
				rawImageData = mapbase + offset;
				rawImageSize = (vinfo.xres*vinfo.yres) * bytesPerPixel;
			}
		}

		if (fwrite(rawImageData, 1, rawImageSize, stdout) < rawImageSize)
			error("fwrite");
		fflush(stdout);

		if (interval_mms==-1) {
			LOG("stop get raw image due to fps argument is 0");
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
