#if !defined(HFILE_libui) && ANDROID_VER>=400
#define HFILE_libui

#include "libutils.h"
#include <stdio.h>

namespace android {

class Rect {
public:
    inline Rect() {
        left = 0;
        top = 0;
        right = 0;
        bottom = 0;
    }
    int32_t left;
    int32_t top;
    int32_t right;
    int32_t bottom;
};

typedef int32_t PixelFormat;

ssize_t bytesPerPixel(PixelFormat format);
ssize_t bitsPerPixel(PixelFormat format);

class Fence : public LightRefBase<Fence>
#if (ANDROID_VER<440)
    , public Flattenable
#endif
{
public:
    static const sp<Fence> NO_FENCE;

    Fence();
    Fence(int fenceFd);
    bool isValid() const { return mFenceFd != -1; }
    int getFd() const { return mFenceFd; }
    status_t wait(unsigned int timeout);

    #if (ANDROID_VER<440)
        //virtual if < 4.4
        size_t getFlattenedSize() const;
        size_t getFdCount() const;
        status_t flatten(void* buffer, size_t size, int fds[], size_t count) const;
        status_t unflatten(void const* buffer, size_t size, int fds[], size_t count);
    #endif

private:
    // Only allow instantiation using ref counting.
    friend class LightRefBase<Fence>;
    ~Fence(); // virtual if < 4.4

    // Disallow copying
    Fence(const Fence& rhs);
    Fence& operator = (const Fence& rhs);
    const Fence& operator = (const Fence& rhs) const;

    int mFenceFd;
};

typedef struct android_native_base_t {
    int magic;
    int version;
    void* reserved[4];
    void (*incRef)(struct android_native_base_t* base);
    void (*decRef)(struct android_native_base_t* base);
} android_native_base_t;

typedef struct ANativeWindowBuffer {
    struct android_native_base_t common;
    int width;
    int height;
    int stride;
    int format;
    int usage;
    void* reserved[2];
    void* handle;
    void* reserved_proc[8];
} ANativeWindowBuffer_t;

struct GraphicBuffer {
    ANativeWindowBuffer* getNativeBuffer() const;
    status_t lock(uint32_t usage, void** vaddr);
    status_t unlock();
    void incStrong(const void* id) const {
        fprintf(stderr, "GraphicBuffer::incStrong id=%p\n", id);
//        fprintf(stderr, "getNativeBuffer()=%p\n", getNativeBuffer());
//        fprintf(stderr, "getNativeBuffer()->common.incRef=%p\n", getNativeBuffer()->common.incRef);
//        fprintf(stderr, "((android_native_base_t*)id)->magic=%p\n", ((android_native_base_t*)id)->magic);
//        getNativeBuffer()->common.incRef((struct android_native_base_t*)id);
    }
    void decStrong(const void* id) const {
        fprintf(stderr, "GraphicBuffer::decStrong id=%p\n", id);
//        fprintf(stderr, "getNativeBuffer()=%p\n", getNativeBuffer());
//        fprintf(stderr, "getNativeBuffer()->common.decRef=%p\n", getNativeBuffer()->common.decRef);
//        fprintf(stderr, "((android_native_base_t*)id)->magic=%p\n", ((android_native_base_t*)id)->magic);
//        getNativeBuffer()->common.decRef((struct android_native_base_t*)id);
    }
};

} //end of namespace android

#endif //end of lib