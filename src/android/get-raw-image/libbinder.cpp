#include "libbinder.h"
using namespace android;

sp<ProcessState> ProcessState::self() {}
void ProcessState::startThreadPool() {}

IPCThreadState* IPCThreadState::self() {}
void IPCThreadState::joinThreadPool(bool isMain) {}

IInterface::IInterface() : RefBase() {}
IInterface::~IInterface() {}

                IBinder::IBinder() : RefBase() {}
                IBinder::~IBinder() {}
sp<IInterface>  IBinder::queryLocalInterface(const String16& descriptor) {}
bool            IBinder::checkSubclass(const void* subclassID) const  {}
BBinder*        IBinder::localBinder() {}
BpBinder*       IBinder::remoteBinder() {}

                BBinder::BBinder() : IBinder() {}
const String16& BBinder::getInterfaceDescriptor() const {}
bool            BBinder::isBinderAlive() const {}
status_t        BBinder::pingBinder() {}
status_t        BBinder::dump(int fd, const Vector<String16>& args) {}
status_t        BBinder::transact( uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {}
status_t        BBinder::linkToDeath(const sp<DeathRecipient>& recipient, void* cookie, uint32_t flags) {}
status_t        BBinder::unlinkToDeath(const wp<DeathRecipient>& recipient, void* cookie, uint32_t flags, wp<DeathRecipient>* outRecipient) {}
void            BBinder::attachObject(const void* objectID, void* object, void* cleanupCookie, object_cleanup_func func) {}
void*           BBinder::findObject(const void* objectID) const {}
void            BBinder::detachObject(const void* objectID) {}
BBinder*        BBinder::localBinder() {}
                BBinder::~BBinder() {}
status_t        BBinder::onTransact(uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags) {}

sp<IServiceManager> android::defaultServiceManager() {}

                    Parcel::Parcel() {}
                    Parcel::~Parcel() {}
const uint8_t*      Parcel::data() const {}
size_t              Parcel::dataSize() const {}
size_t              Parcel::dataAvail() const {}
size_t              Parcel::dataPosition() const {}
size_t              Parcel::dataCapacity() const {}
status_t            Parcel::writeInterfaceToken(const String16& interface) {}
status_t            Parcel::writeInt32(int32_t val) {}
status_t            Parcel::writeStrongBinder(const sp<IBinder>& val) {}
status_t            Parcel::read(void* outData, size_t len) const {}
const void*         Parcel::readInplace(size_t len) const {}
int32_t             Parcel::readInt32() const {}
