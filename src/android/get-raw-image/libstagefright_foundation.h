#if !defined(libstagefright_foundation) && ANDROID_VER>=400
#define libstagefright_foundation

#include "libutils.h"

namespace android {

struct ALooper : public RefBase {
    typedef int32_t handler_id;
    ALooper();
    status_t start(bool runOnCallingThread = false, bool canCallJava = false, int32_t priority = 0/*PRIORITY_DEFAULT*/);
    void setName(const char *name);
    static int64_t GetNowUs();
protected:
    virtual ~ALooper();
private:
    char __data[sizeof(void*)*64];
    /*
    Mutex mLock;
    Condition mQueueChangedCondition;
    AString mName;
    List<Event> mEventQueue;
    sp<LooperThread> mThread;
    bool mRunningLocally;
    */
};

struct AMessage : public RefBase {
    AMessage(uint32_t what = 0, ALooper::handler_id target = 0);
    void setInt32(const char *name, int32_t value);
    void setFloat(const char *name, float value);
#if (ANDROID_VER>=440)
    void setString(const char *name, const char *s, int len = -1);
#else
    void setString(const char *name, const char *s, long len = -1);
#endif
protected:
    virtual ~AMessage();
private:
	char __data[sizeof(void*)*512];
    /*
    uint32_t mWhat;
    ALooper::handler_id mTarget;
    Max16Bytes mItems[64];
    size_t mNumItems;
    */
};

struct AHandler : public RefBase {
    AHandler() : mID(0) {}
    sp<ALooper> looper();
protected:
    virtual void onMessageReceived(const sp<AMessage> &msg) = 0;
private:
    ALooper::handler_id mID;
};

struct ABuffer : public RefBase {
    ABuffer(size_t capacity);
    ABuffer(void *data, size_t capacity);
protected:
    virtual ~ABuffer();
private:
    char __data[sizeof(void*)*64];
    /*
    sp<AMessage> mFarewell;
    sp<AMessage> mMeta;
    void *mData;
    size_t mCapacity;
    size_t mRangeOffset;
    size_t mRangeLength;
    int32_t mInt32Data;
    bool mOwnsData;
    */
};

} //end of namespace android

#endif //end of lib