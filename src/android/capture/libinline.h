#if !defined(HFILE_libinline)
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

////////////////////////////////////////////////// Sync //////////////////////////////////////////////////
#ifndef _LIBS_UTILS_SYNC_H
#define _LIBS_UTILS_SYNC_H

#include <stdint.h>
#include <sys/types.h>
#include <pthread.h>

namespace android {

class Condition;

class Mutex {
public:
    inline Mutex() {pthread_mutex_init(&mMutex, NULL);}
    inline ~Mutex() {pthread_mutex_destroy(&mMutex);}
    inline status_t    lock() {return -pthread_mutex_lock(&mMutex);}
    inline void        unlock() {pthread_mutex_unlock(&mMutex);}
    inline status_t    tryLock() {return -pthread_mutex_trylock(&mMutex);}
    class Autolock {
    public:
        inline Autolock(Mutex& mutex) : mLock(mutex)  { mLock.lock(); }
        inline Autolock(Mutex* mutex) : mLock(*mutex) { mLock.lock(); }
        inline ~Autolock() { mLock.unlock(); }
    private:
        Mutex& mLock;
    };
private:
    friend class Condition;
                Mutex(const Mutex&);
    Mutex&      operator = (const Mutex&);
    pthread_mutex_t mMutex;
};
typedef Mutex::Autolock AutoMutex;

class Condition {
public:
    inline Condition() {pthread_cond_init(&mCond, NULL);}
    inline ~Condition() {pthread_cond_destroy(&mCond);}
    inline status_t wait(Mutex& mutex) {return -pthread_cond_wait(&mCond, &mutex.mMutex);}
    inline status_t waitAbsMono(Mutex& mutex, const struct timespec *abstime) { return -pthread_cond_timedwait_monotonic_np(&mCond, &mutex.mMutex, abstime);}
    inline void signal() {pthread_cond_signal(&mCond);}
    inline void broadcast() {pthread_cond_broadcast(&mCond);}
private:
    pthread_cond_t mCond;
};

}; // namespace android

#endif // _LIBS_UTILS_SYNC_H