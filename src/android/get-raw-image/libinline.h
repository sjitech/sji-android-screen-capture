#if !defined(HFILE_libinline) && ANDROID_VER>=400
#define HFILE_libinline

#include <sys/types.h>

namespace android {

typedef int32_t status_t;

#if 1
template <typename T> class sp {
public:
    inline     sp()                          { m_ptr = 0; }
    inline     sp(T* other)                  { m_ptr = other; if (other) other->incStrong(this); }
    inline     ~sp()                         { if (m_ptr) m_ptr->decStrong(this); }
    inline sp& operator=(T* other)           { if (other) other->incStrong(this); if (m_ptr) m_ptr->decStrong(this); m_ptr = other; return *this; }
    inline sp& operator=(const sp<T>& other) { T* otherPtr(other.m_ptr); if (otherPtr) otherPtr->incStrong(this); if (m_ptr) m_ptr->decStrong(this); m_ptr = otherPtr; return *this; }
    template<typename U>
    inline sp& operator=(const sp<U>& other) { T* otherPtr(other.m_ptr); if (otherPtr) otherPtr->incStrong(this); if (m_ptr) m_ptr->decStrong(this); m_ptr = otherPtr; return *this; }
    inline T&  operator*() const             { return *m_ptr; }
    inline T*  operator->() const            { return m_ptr; }
    inline T*  get() const                   { return m_ptr; }
    inline operator T*() const               { return m_ptr; }
private:
    template<typename Y> friend class wp;
    T* m_ptr;
};

#else
template <typename T> class sp {
public:
    inline     sp()                          { m_ptr = 0; }
    inline     sp(T* other)                  { m_ptr = other; }
    inline     ~sp()                         { m_ptr = 0; }
    inline sp& operator=(T* other)           { m_ptr = other; }
    inline sp& operator=(const sp<T>& other) { m_ptr = other; }
    template<typename U>
    inline sp& operator=(const sp<U>& other) { m_ptr = other; }
    inline T&  operator*() const             { return *m_ptr; }
    inline T*  operator->() const            { return m_ptr; }
    inline T*  get() const                   { return m_ptr; }
    inline operator T*() const               { return m_ptr; }
private:
    template<typename Y> friend class wp;
    T* m_ptr;
};
#endif

} //end of namespace android

#endif //end of lib