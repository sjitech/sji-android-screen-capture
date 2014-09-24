#include "libui.h"
using namespace android;

const sp<Fence> Fence::NO_FENCE = sp<Fence>();
Fence::Fence() {}
Fence::Fence(int fenceFd) {}
Fence::~Fence() {}
status_t Fence::wait(unsigned int timeout) {}

#if (ANDROID_VER<440)
    size_t Fence::getFlattenedSize() const {}
    size_t Fence::getFdCount() const {}
    status_t Fence::flatten(void* buffer, size_t size, int fds[], size_t count) const {}
    status_t Fence::unflatten(void const* buffer, size_t size, int fds[], size_t count) {}
#endif

GraphicBuffer::GraphicBuffer(uint32_t w, uint32_t h, PixelFormat format, uint32_t usage) {}
GraphicBuffer::~GraphicBuffer() {}
ANativeWindowBuffer* GraphicBuffer::getNativeBuffer() const {}
status_t GraphicBuffer::lock(uint32_t usage, void** vaddr) {}
status_t GraphicBuffer::unlock() {}

namespace android {
	ssize_t bytesPerPixel(PixelFormat format) {}
	ssize_t bitsPerPixel(PixelFormat format) {}
};
