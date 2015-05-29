#if !defined(HFILE_libutils) && ANDROID_VER>=400
#define HFILE_libutils

#include "libinline.h"
#include "libcutils.h"

typedef uint16_t char16_t;

extern "C" {
    int strzcmp16(const char16_t *s1, size_t n1, const char16_t *s2, size_t n2);
    enum {
        SYSTEM_TIME_REALTIME = 0,  // system-wide realtime clock
        SYSTEM_TIME_MONOTONIC = 1, // monotonic time since unspecified starting point
        SYSTEM_TIME_PROCESS = 2,   // high-resolution per-process clock
        SYSTEM_TIME_THREAD = 3,    // high-resolution per-thread clock
        SYSTEM_TIME_BOOTTIME = 4   // same as SYSTEM_TIME_MONOTONIC, but including CPU suspend time
    };
    #ifdef __cplusplus
        int64_t systemTime(int clock = SYSTEM_TIME_MONOTONIC);
    #else
        int64_t systemTime(int clock);
    #endif // def __cplusplus
}

namespace android {

class RefBase {
public:
    void incStrong(const void* id) const;
    void decStrong(const void* id) const;
    class weakref_type {
    public:
        void decWeak(const void* id);
        bool attemptIncStrong(const void* id);
    };
    weakref_type* createWeak(const void* id) const;
protected:
                 RefBase();
    virtual      ~RefBase();
    virtual void onFirstRef();
    virtual void onLastStrongRef(const void* id);
    virtual bool onIncStrongAttempted(uint32_t flags, const void* id);
    virtual void onLastWeakRef(const void* id);
private:
    void* const mRefs;
};

template <class T> class LightRefBase {
public:
    inline LightRefBase() : mCount(0) {}
    inline void incStrong(const void* id) const {
        android_atomic_inc(&mCount);
    }
    inline void decStrong(const void* id) const {
        if (android_atomic_dec(&mCount) == 1) {
            delete static_cast<const T*>(this);
        }
    }
protected:
    inline ~LightRefBase() {}
private:
    mutable volatile int32_t mCount;
};

template <typename T> class wp {
public:
    inline        wp()                { m_ptr = 0; m_refs = 0; }
    inline        wp(T* other)        { m_ptr = other; if (other) m_refs = other->createWeak(this); }
    inline        ~wp()               { if (m_ptr) m_refs->decWeak(this); }
    inline wp<T>& operator=(T* other) { RefBase::weakref_type* newRefs = other ? other->createWeak(this) : 0; if (m_ptr) m_refs->decWeak(this); m_ptr = other; m_refs = newRefs; return *this; }
    inline sp<T>  promote() const     { sp<T> result; if (m_ptr && m_refs->attemptIncStrong(&result)) result.m_ptr = m_ptr; return result; }
private:
    T* m_ptr;
    RefBase::weakref_type* m_refs;
};

class SharedBuffer {
public:
    static inline size_t sizeFromData(const void* data) { return data ? (static_cast<const SharedBuffer *>(data)-1)->mSize : 0; }
private:
    int32_t  mRefs;
    size_t   mSize;
    uint32_t mReserved[2];
};

class String8 {
public:
    String8();
    String8(const char *s);
    ~String8();
    inline const char* string() const   { return mString; }
    inline operator const char*() const { return mString; }
    inline size_t size() const          { return SharedBuffer::sizeFromData(mString) - 1; }
private:
    const char* mString;
};

class String16 {
public:
    String16();
    String16(const char16_t *s);
    String16(const char *s);
    ~String16();
    inline const char16_t* string() const   { return mString; }
    inline operator const char16_t*() const { return mString; }
    inline size_t size() const              { return SharedBuffer::sizeFromData(mString)/sizeof(char16_t) - 1; }
    inline bool operator==(const String16& other) const { return strzcmp16(mString, size(), other.mString, other.size()) == 0; }
private:
    const char16_t* mString;
};

#if (ANDROID_VER<440)
    class Flattenable {
    public:
        virtual size_t getFlattenedSize() const = 0;
        virtual size_t getFdCount() const = 0;
        virtual status_t flatten(void* buffer, size_t size, int fds[], size_t count) const = 0;
        virtual status_t unflatten(void const* buffer, size_t size, int fds[], size_t count) = 0;
    protected:
        virtual ~Flattenable() = 0;
    };
#endif

} //end of namespace android

#endif //end of lib