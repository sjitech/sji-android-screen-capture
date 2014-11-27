#if !defined(HFILE_libpowermanager) && ANDROID_VER>=400
#define HFILE_libpowermanager

#include "libutils.h"

namespace android {

class IBinder;

class IPowerManager : public IInterface {
public:
    virtual const String16& getInterfaceDescriptor() const;
    virtual ~IPowerManager();
    static sp<IPowerManager> asInterface(const sp<IBinder>& obj);

    #if ANDROID_VER>=500
        virtual status_t acquireWakeLock(int flags, const sp<IBinder>& lock, const String16& tag, const String16& packageName, bool isOneWay = false) = 0;
        virtual status_t releaseWakeLock(const sp<IBinder>& lock, int flags, bool isOneWay = false) = 0;
    #elif ANDROID_VER>=440
        virtual status_t acquireWakeLock(int flags, const sp<IBinder>& lock, const String16& tag, const String16& packageName) = 0;
        virtual status_t releaseWakeLock(const sp<IBinder>& lock, int flags) = 0;
    #else
        virtual status_t acquireWakeLock(int flags, const sp<IBinder>& lock, const String16& tag) = 0;
        virtual status_t releaseWakeLock(const sp<IBinder>& lock, int flags) = 0;
    #endif
};

} //end of namespace android

#endif //end of lib