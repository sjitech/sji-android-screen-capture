#include "libutils.h"

int strzcmp16(const char16_t *s1, size_t n1, const char16_t *s2, size_t n2) {}

using namespace android;

String8::String8() {}
String8::String8(const char *s) {}
String8::~String8() {}
String16::String16() {}
String16::String16(const char *s) {}
String16::String16(const char16_t *s) {}
String16::~String16() {}

void RefBase::incStrong(const void* id) const {}
void RefBase::decStrong(const void* id) const {}
void RefBase::weakref_type::decWeak(const void* id) {}
bool RefBase::weakref_type::attemptIncStrong(const void* id) {}
RefBase::weakref_type* RefBase::createWeak(const void* id) const {}
RefBase::RefBase() : mRefs(0) {}
RefBase::~RefBase() {}
void RefBase::onFirstRef() {}
void RefBase::onLastStrongRef(const void* id) {}
bool RefBase::onIncStrongAttempted(uint32_t flags, const void* id) {}
void RefBase::onLastWeakRef(const void* id) {}

#if (ANDROID_VER<440)
	Flattenable::~Flattenable() {}
#endif

VectorImpl::VectorImpl(size_t itemSize, uint32_t flags) {}
VectorImpl::~VectorImpl() {}
ssize_t VectorImpl::add() {}
void*   VectorImpl::editArrayImpl() {}
void*   VectorImpl::editItemLocation(size_t index) {}
void    VectorImpl::finish_vector() {}
