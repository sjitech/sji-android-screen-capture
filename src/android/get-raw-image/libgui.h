#if !defined(HFILE_libgui) && ANDROID_VER>=400
#define HFILE_libgui

#include "libbinder.h"
#include "libui.h"

namespace android {

class ScreenshotClient {
public:
    ScreenshotClient();
    #if (ANDROID_VER>=440)
        ~ScreenshotClient();
    #endif
    #if (ANDROID_VER>=420)
        status_t update(const sp<IBinder>& display);
        status_t update(const sp<IBinder>& display, uint32_t reqWidth, uint32_t reqHeight);
    #elif (ANDROID_VER>=400)
        status_t update();
        status_t update(uint32_t reqWidth, uint32_t reqHeight);
    #endif
    void release();
    void const* getPixels() const;

    uint32_t getWidth() const;
    uint32_t getHeight() const;
    uint32_t getStride() const; //base + getStride()*bytesPerPixel will get start address of next row
    int32_t getFormat() const;
    size_t getSize() const; // size of allocated memory in bytes
private:
    char __data[sizeof(void*)*256];
    /*
    mutable sp<CpuConsumer> mCpuConsumer;
    mutable sp<BufferQueue> mBufferQueue;
    CpuConsumer::LockedBuffer mBuffer;
    bool mHaveBuffer;
    */
};

struct DisplayInfo {
    uint32_t w;
    uint32_t h;
    char __data[sizeof(void*)*16];
};

#if (ANDROID_VER>=420)
    // from window.h  attributes queriable with query()
    enum {
        NATIVE_WINDOW_WIDTH     = 0,
        NATIVE_WINDOW_HEIGHT    = 1,
        NATIVE_WINDOW_FORMAT    = 2,
        NATIVE_WINDOW_MIN_UNDEQUEUED_BUFFERS = 3,
        NATIVE_WINDOW_QUEUES_TO_WINDOW_COMPOSER = 4,
        NATIVE_WINDOW_CONCRETE_TYPE = 5,
        NATIVE_WINDOW_DEFAULT_WIDTH = 6,
        NATIVE_WINDOW_DEFAULT_HEIGHT = 7,
        NATIVE_WINDOW_TRANSFORM_HINT = 8,
        NATIVE_WINDOW_CONSUMER_RUNNING_BEHIND = 9,
        NATIVE_WINDOW_CONSUMER_USAGE_BITS = 10
    };

    // from window.h parameter for NATIVE_WINDOW_[API_][DIS]CONNECT
    // enum {
    //     NATIVE_WINDOW_API_EGL = 1,
    //     NATIVE_WINDOW_API_CPU = 2,
    //     NATIVE_WINDOW_API_MEDIA = 3,
    //     NATIVE_WINDOW_API_CAMERA = 4,
    // };
    
    //from graphics.h
    enum {
        HAL_PIXEL_FORMAT_RGBA_8888          = 1,
        // HAL_PIXEL_FORMAT_RGBX_8888          = 2,
        // HAL_PIXEL_FORMAT_RGB_888            = 3,
        // HAL_PIXEL_FORMAT_RGB_565            = 4,
        // HAL_PIXEL_FORMAT_BGRA_8888          = 5,
        // HAL_PIXEL_FORMAT_RGBA_5551          = 6,
        // HAL_PIXEL_FORMAT_RGBA_4444          = 7,
        // HAL_PIXEL_FORMAT_YV12   = 0x32315659, // YCrCb 4:2:0 Planar
    };

    //from gralloc.h
    enum {
        // GRALLOC_USAGE_SW_READ_NEVER         = 0x00000000,
        // GRALLOC_USAGE_SW_READ_RARELY        = 0x00000002,
        GRALLOC_USAGE_SW_READ_OFTEN         = 0x00000003,
        // GRALLOC_USAGE_SW_READ_MASK          = 0x0000000F,
        // GRALLOC_USAGE_SW_WRITE_NEVER        = 0x00000000,
        // GRALLOC_USAGE_SW_WRITE_RARELY       = 0x00000020,
        GRALLOC_USAGE_SW_WRITE_OFTEN        = 0x00000030,
        // GRALLOC_USAGE_SW_WRITE_MASK         = 0x000000F0,
        // GRALLOC_USAGE_HW_TEXTURE            = 0x00000100,
        // GRALLOC_USAGE_HW_RENDER             = 0x00000200,
        // GRALLOC_USAGE_HW_2D                 = 0x00000400,
        // GRALLOC_USAGE_HW_COMPOSER           = 0x00000800,
        // GRALLOC_USAGE_HW_FB                 = 0x00001000,
        // GRALLOC_USAGE_HW_VIDEO_ENCODER      = 0x00010000,
        // GRALLOC_USAGE_HW_CAMERA_WRITE       = 0x00020000,
        // GRALLOC_USAGE_HW_CAMERA_READ        = 0x00040000,
        // GRALLOC_USAGE_HW_CAMERA_ZSL         = 0x00060000,
        // GRALLOC_USAGE_HW_CAMERA_MASK        = 0x00060000,
        // GRALLOC_USAGE_HW_MASK               = 0x00071F00,
        // GRALLOC_USAGE_EXTERNAL_DISP         = 0x00002000,
        // GRALLOC_USAGE_PROTECTED             = 0x00004000,
    };

    #if (ANDROID_VER>=440)
        class IGraphicBufferProducer;
    #elif (ANDROID_VER>=420)
        class ISurfaceTexture;
    #endif

    class SurfaceComposerClient {
    public:
        static sp<IBinder> getBuiltInDisplay(int32_t id); //id: 0:main 1:HDMI
        static sp<IBinder> createDisplay(const String8& displayName, bool secure);
        #if (ANDROID_VER>=440)
            static void destroyDisplay(const sp<IBinder>& display);
        #endif
        static status_t getDisplayInfo(const sp<IBinder>& display, DisplayInfo* info);
        static void openGlobalTransaction();
        static void closeGlobalTransaction(bool synchronous = false);
        #if (ANDROID_VER>=440)
            static void setDisplaySurface(const sp<IBinder>& token, const sp<IGraphicBufferProducer>& bufferProducer);
        #elif (ANDROID_VER>=420)
            static void setDisplaySurface(const sp<IBinder>& token, const sp<ISurfaceTexture>& bufferProducer);
        #endif
        static void setDisplayLayerStack(const sp<IBinder>& token, uint32_t layerStack);
        static void setDisplayProjection(const sp<IBinder>& token, uint32_t orientation, const Rect& layerStackRect, const Rect& displayRect);
    };

    class GraphicBuffer;
    class Fence;

    class IGraphicBufferAlloc : public IInterface {
    public:
        virtual const String16& getInterfaceDescriptor() const;
        IGraphicBufferAlloc();
        virtual ~IGraphicBufferAlloc();

        virtual sp<GraphicBuffer> createGraphicBuffer(uint32_t w, uint32_t h, PixelFormat format, uint32_t usage, status_t* error) = 0;
        // virtual GraphicBuffer* createGraphicBuffer(uint32_t w, uint32_t h, PixelFormat format, uint32_t usage, status_t* error) = 0;
    };

    class ISurfaceComposerClient;

    class ISurfaceComposer: public IInterface {
    public:
        virtual const String16& getInterfaceDescriptor() const;
        ISurfaceComposer();
        virtual ~ISurfaceComposer();

        virtual sp<ISurfaceComposerClient> createConnection() = 0;
        virtual sp<IGraphicBufferAlloc> createGraphicBufferAlloc() = 0;
    };

    class ComposerService {
    public:
        static sp<ISurfaceComposer> getComposerService();
    };

    typedef int64_t nsecs_t;
    typedef void* EGLDisplay;
    typedef void* EGLSyncKHR;

    #if (ANDROID_VER>=440)
        class IGraphicBufferProducer : public IInterface {
        public:
            enum {
                BUFFER_NEEDS_REALLOCATION = 0x1,
                RELEASE_ALL_BUFFERS       = 0x2,
            };
            struct QueueBufferInput {
                int64_t timestamp;
                int isAutoTimestamp;
                Rect crop;
                int scalingMode;
                uint32_t transform;
                int async;
                sp<Fence> fence;
            };
            struct QueueBufferOutput {
                uint32_t width;
                uint32_t height;
                uint32_t transformHint;
                uint32_t numPendingBuffers;
            };

            virtual const String16& getInterfaceDescriptor() const;
            IGraphicBufferProducer();
            virtual ~IGraphicBufferProducer();

            virtual status_t requestBuffer(int slot, sp<GraphicBuffer>* buf) = 0;
            virtual status_t setBufferCount(int bufferCount) = 0;
            virtual status_t dequeueBuffer(int *slot, sp<Fence>* fence, bool async, uint32_t w, uint32_t h, uint32_t format, uint32_t usage) = 0;
            virtual status_t queueBuffer(int slot, const QueueBufferInput& input, QueueBufferOutput* output) = 0;
            virtual void     cancelBuffer(int slot, const sp<Fence>& fence) = 0;
            virtual int      query(int what, int* value) = 0;
            virtual status_t connect(const sp<IBinder>& token, int api, bool producerControlledByApp, QueueBufferOutput* output) = 0;
            virtual status_t disconnect(int api) = 0;
        };

        class BnGraphicBufferProducer : public BnInterface<IGraphicBufferProducer> {
        public:
            virtual status_t onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0);
        };

    #elif (ANDROID_VER>=420)
        #define IGraphicBufferProducer ISurfaceTexture
        #define BnGraphicBufferProducer BnSurfaceTexture
        
        class ISurfaceTexture : public IInterface {
        public:
            enum {
                BUFFER_NEEDS_REALLOCATION = 0x1,
                RELEASE_ALL_BUFFERS       = 0x2,
            };

            struct QueueBufferInput : public Flattenable {
                size_t getFlattenedSize() const;
                size_t getFdCount() const;
                status_t flatten(void* buffer, size_t size, int fds[], size_t count) const;
                status_t unflatten(void const* buffer, size_t size, int fds[], size_t count);
                int64_t timestamp;
                Rect crop;
                int scalingMode;
                uint32_t transform;
                sp<Fence> fence;
            };
            struct QueueBufferOutput {
                uint32_t width;
                uint32_t height;
                uint32_t transformHint;
                uint32_t numPendingBuffers;
            };

            virtual const String16& getInterfaceDescriptor() const;
            ISurfaceTexture();
            virtual ~ISurfaceTexture();

            virtual status_t requestBuffer(int slot, sp<GraphicBuffer>* buf) = 0;
            virtual status_t setBufferCount(int bufferCount) = 0;
            virtual status_t dequeueBuffer(int *slot, sp<Fence>& fence, uint32_t w, uint32_t h, uint32_t format, uint32_t usage) = 0;
            virtual status_t queueBuffer(int slot, const QueueBufferInput& input, QueueBufferOutput* output) = 0;
            virtual void     cancelBuffer(int slot, sp<Fence> fence) = 0;
            virtual int      query(int what, int* value) = 0;
            virtual status_t setSynchronousMode(bool enabled) = 0;
            virtual status_t connect(int api, QueueBufferOutput* output) = 0;
            virtual status_t disconnect(int api) = 0;
        };

        class BnSurfaceTexture : public BnInterface<ISurfaceTexture> {
        public:
            virtual status_t onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0);
        };
    #endif

#elif (ANDROID_VER>=400)
    class SurfaceComposerClient {
    public:
        static status_t getDisplayInfo(int32_t id, DisplayInfo* info);
    };
#endif

} //end of namespace android

#endif //end of lib