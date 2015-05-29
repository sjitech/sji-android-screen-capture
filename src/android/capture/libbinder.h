#if !defined(HFILE_libbinder) && ANDROID_VER>=400
#define HFILE_libbinder

#include "libutils.h"

namespace android {

class BBinder;
class BpBinder;
class IInterface;
class Parcel;
template <class TYPE> class Vector;

//from ProcessState.h
class ProcessState : public virtual RefBase{
public:
    static sp<ProcessState> self();
    void startThreadPool();
};

//from ThreadState.h
class IPCThreadState {
public:
    static IPCThreadState* self();
    void joinThreadPool(bool isMain = true);
};

//from IBinder.h
class IBinder : public virtual RefBase {
public:
    class DeathRecipient : public virtual RefBase {
    public:
        virtual void        binderDied(const wp<IBinder>& who) = 0;
    };
    typedef void (*object_cleanup_func)(const void* id, void* obj, void* cleanupCookie);
                            IBinder();
    virtual sp<IInterface>  queryLocalInterface(const String16& descriptor);
    virtual const String16& getInterfaceDescriptor() const = 0;
    virtual bool            isBinderAlive() const = 0;
    virtual status_t        pingBinder() = 0;
    virtual status_t        dump(int fd, const Vector<String16>& args) = 0;
    virtual status_t        transact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0) = 0;
    virtual status_t        linkToDeath(const sp<DeathRecipient>& recipient, void* cookie = NULL, uint32_t flags = 0) = 0;
    virtual status_t        unlinkToDeath(  const wp<DeathRecipient>& recipient, void* cookie = NULL, uint32_t flags = 0, wp<DeathRecipient>* outRecipient = NULL) = 0;
    virtual bool            checkSubclass(const void* subclassID) const;
    virtual void            attachObject(const void* objectID, void* object, void* cleanupCookie, object_cleanup_func func) = 0;
    virtual void*           findObject(const void* objectID) const = 0;
    virtual void            detachObject(const void* objectID) = 0;
    virtual BBinder*        localBinder();
    virtual BpBinder*       remoteBinder();
protected:
    virtual                 ~IBinder();
};

//from Binder.h
class BBinder : public IBinder {
public:
                            BBinder();
    virtual const String16& getInterfaceDescriptor() const;
    virtual bool            isBinderAlive() const;
    virtual status_t        pingBinder();
    virtual status_t        dump(int fd, const Vector<String16>& args);
    virtual status_t        transact( uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0);
    virtual status_t        linkToDeath(const sp<DeathRecipient>& recipient, void* cookie = NULL, uint32_t flags = 0);
    virtual status_t        unlinkToDeath(const wp<DeathRecipient>& recipient, void* cookie = NULL, uint32_t flags = 0, wp<DeathRecipient>* outRecipient = NULL);
    virtual void            attachObject(const void* objectID, void* object, void* cleanupCookie, object_cleanup_func func);
    virtual void*           findObject(const void* objectID) const;
    virtual void            detachObject(const void* objectID);
    virtual BBinder*        localBinder();
protected:
    virtual                 ~BBinder();
    virtual status_t        onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags = 0);
private:
    void* mExtras;
    void* mReserved0;
};

//from IInterface.h
class IInterface : public virtual RefBase {
public:
    IInterface();
protected:
    virtual                 ~IInterface();
    virtual IBinder*        onAsBinder() = 0;
};

template<typename INTERFACE> class BnInterface : public INTERFACE, public BBinder {
public:
    virtual sp<IInterface>  queryLocalInterface(const String16& _descriptor) { return (_descriptor == INTERFACE::getInterfaceDescriptor()) ? this : NULL; }
    virtual const String16& getInterfaceDescriptor() const                   { return INTERFACE::getInterfaceDescriptor(); }
protected:
    virtual IBinder*        onAsBinder() { return this; }
};

class IServiceManager : public IInterface {
public:
    virtual const String16& getInterfaceDescriptor() const;
    virtual ~IServiceManager();

    virtual sp<IBinder>         getService( const String16& name) const = 0;
    virtual sp<IBinder>         checkService( const String16& name) const = 0;
    virtual status_t            addService( /*const String16& name, const sp<IBinder>& service, bool allowIsolated = false*/) = 0;
    virtual void/*Vector<String16>*/    listServices() = 0;
};

sp<IServiceManager> defaultServiceManager();


class Parcel {
public:
                        Parcel();
                        ~Parcel();
    const uint8_t*      data() const;
    size_t              dataSize() const;
    size_t              dataPosition() const;
    size_t              dataAvail() const;
    size_t              dataCapacity() const;
    status_t            writeInterfaceToken(const String16& interface);
    status_t            writeInt32(int32_t val);
    status_t            writeStrongBinder(const sp<IBinder>& val);
    status_t            read(void* outData, size_t len) const;
    const void*         readInplace(size_t len) const;
    int32_t             readInt32() const;
private:
    char _data[sizeof(void*)*32];
};

} //end of namespace android

#endif //end of lib