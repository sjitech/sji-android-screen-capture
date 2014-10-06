#include "libskia.h"

SkBitmap::SkBitmap() {}
SkBitmap::~SkBitmap() {}
#if (ANDROID_VER>=440)
    bool SkBitmap::setConfig(SkBitmap::Config c, int w, int h, size_t rowBytes) {}
#elif (ANDROID_VER>=420)
    bool SkBitmap::setConfig(SkBitmap::Config c, int w, int h, int rowBytes) {}
#endif
void SkBitmap::setPixels(void* base, SkColorTable* color) {}

SkDynamicMemoryWStream::SkDynamicMemoryWStream() {}
SkDynamicMemoryWStream::~SkDynamicMemoryWStream() {}
SkData* SkDynamicMemoryWStream::copyToData() const {}

bool SkImageEncoder::EncodeStream(SkWStream* s, SkBitmap const& b, SkImageEncoder::Type t, int q) {}

