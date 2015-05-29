#if !defined(HFILE_libskia) && ANDROID_VER>=420
#define HFILE_libskia

#include <sys/types.h>

struct SkColorTable;

struct SkBitmap {
    SkBitmap();
    ~SkBitmap();
    enum Config {
        #if (ANDROID_VER>=440)
            kARGB_8888_Config = 5
        #elif (ANDROID_VER>=420)
            kARGB_8888_Config = 6
        #endif
    };
    #if (ANDROID_VER>=440)
        bool setConfig(SkBitmap::Config c, int w, int h, size_t rowBytes);
    #elif (ANDROID_VER>=420)
        bool setConfig(SkBitmap::Config c, int w, int h, int rowBytes);
    #endif
    void setPixels(void* base, SkColorTable* color=0);

    char data[sizeof(void*)*128];
};

struct SkData {
    virtual ~SkData();
    mutable int32_t fRefCnt;
    void* fReleaseProc;
    void* fReleaseProcContext;
    const void* p;
    size_t      size;
};

struct SkWStream {
    char data[sizeof(void*)*128];
};

struct SkDynamicMemoryWStream : public SkWStream {
    SkDynamicMemoryWStream();
    ~SkDynamicMemoryWStream();
    SkData* copyToData() const;
};

struct SkImageEncoder {
    enum Type {
        #if (ANDROID_VER>=440)
            kJPEG_Type = 4
        #elif (ANDROID_VER>=420)
            kJPEG_Type = 0
        #endif
    };
    static bool EncodeStream(SkWStream* s, SkBitmap const& b, SkImageEncoder::Type t, int q);
};


#endif //end of lib