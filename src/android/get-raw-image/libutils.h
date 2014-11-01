#if !defined(HFILE_libutils) && ANDROID_VER>=400
#define HFILE_libutils

#include "libinline.h"
#include "libcutils.h"

typedef uint16_t char16_t;
extern "C" int strzcmp16(const char16_t *s1, size_t n1, const char16_t *s2, size_t n2);

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


///////////////////////////////////////////////////////////////////////////////
//from TypeHelpers.h
template <typename T> struct trait_trivial_ctor { enum { value = false }; };
template <typename T> struct trait_trivial_dtor { enum { value = false }; };
template <typename T> struct trait_trivial_copy { enum { value = false }; };
template <typename T> struct trait_trivial_move { enum { value = false }; };
template <typename T> struct trait_pointer      { enum { value = false }; };
template <typename T> struct trait_pointer<T*>  { enum { value = true }; };

template <typename TYPE> struct traits {
    enum {
        // whether this type is a pointer
        is_pointer          = trait_pointer<TYPE>::value,
        // whether this type's constructor is a no-op
        has_trivial_ctor    = is_pointer || trait_trivial_ctor<TYPE>::value,
        // whether this type's destructor is a no-op
        has_trivial_dtor    = is_pointer || trait_trivial_dtor<TYPE>::value,
        // whether this type type can be copy-constructed with memcpy
        has_trivial_copy    = is_pointer || trait_trivial_copy<TYPE>::value,
        // whether this type can be moved with memmove
        has_trivial_move    = is_pointer || trait_trivial_move<TYPE>::value
    };
};

#define ANDROID_TRIVIAL_CTOR_TRAIT( T ) template<> struct trait_trivial_ctor< T >   { enum { value = true }; };
#define ANDROID_TRIVIAL_DTOR_TRAIT( T ) template<> struct trait_trivial_dtor< T >   { enum { value = true }; };
#define ANDROID_TRIVIAL_COPY_TRAIT( T ) template<> struct trait_trivial_copy< T >   { enum { value = true }; };
#define ANDROID_TRIVIAL_MOVE_TRAIT( T ) template<> struct trait_trivial_move< T >   { enum { value = true }; };

#define ANDROID_BASIC_TYPES_TRAITS( T ) ANDROID_TRIVIAL_CTOR_TRAIT( T ) ANDROID_TRIVIAL_DTOR_TRAIT( T ) ANDROID_TRIVIAL_COPY_TRAIT( T ) ANDROID_TRIVIAL_MOVE_TRAIT( T )

ANDROID_BASIC_TYPES_TRAITS( void )
ANDROID_BASIC_TYPES_TRAITS( bool )
ANDROID_BASIC_TYPES_TRAITS( char )
ANDROID_BASIC_TYPES_TRAITS( unsigned char )
ANDROID_BASIC_TYPES_TRAITS( short )
ANDROID_BASIC_TYPES_TRAITS( unsigned short )
ANDROID_BASIC_TYPES_TRAITS( int )
ANDROID_BASIC_TYPES_TRAITS( unsigned int )
ANDROID_BASIC_TYPES_TRAITS( long )
ANDROID_BASIC_TYPES_TRAITS( unsigned long )
ANDROID_BASIC_TYPES_TRAITS( long long )
ANDROID_BASIC_TYPES_TRAITS( unsigned long long )
ANDROID_BASIC_TYPES_TRAITS( float )
ANDROID_BASIC_TYPES_TRAITS( double )

template<typename TYPE> inline
void construct_type(TYPE* p, size_t n) {
    if (!traits<TYPE>::has_trivial_ctor) {
        while (n--) {
            new(p++) TYPE;
        }
    }
}

template<typename TYPE> inline
void destroy_type(TYPE* p, size_t n) {
    if (!traits<TYPE>::has_trivial_dtor) {
        while (n--) {
            p->~TYPE();
            p++;
        }
    }
}

template<typename TYPE> inline
void copy_type(TYPE* d, const TYPE* s, size_t n) {
    if (!traits<TYPE>::has_trivial_copy) {
        while (n--) {
            new(d) TYPE(*s);
            d++, s++;
        }
    } else {
        memcpy(d,s,n*sizeof(TYPE));
    }
}

template<typename TYPE> inline
void splat_type(TYPE* where, const TYPE* what, size_t n) {
    if (!traits<TYPE>::has_trivial_copy) {
        while (n--) {
            new(where) TYPE(*what);
            where++;
        }
    } else {
        while (n--) {
            *where++ = *what;
        }
    }
}

template<typename TYPE> inline
void move_forward_type(TYPE* d, const TYPE* s, size_t n = 1) {
    if ((traits<TYPE>::has_trivial_dtor && traits<TYPE>::has_trivial_copy)
            || traits<TYPE>::has_trivial_move)
    {
        memmove(d,s,n*sizeof(TYPE));
    } else {
        d += n;
        s += n;
        while (n--) {
            --d, --s;
            if (!traits<TYPE>::has_trivial_copy) {
                new(d) TYPE(*s);
            } else {
                *d = *s;
            }
            if (!traits<TYPE>::has_trivial_dtor) {
                s->~TYPE();
            }
        }
    }
}

template<typename TYPE> inline
void move_backward_type(TYPE* d, const TYPE* s, size_t n = 1) {
    if ((traits<TYPE>::has_trivial_dtor && traits<TYPE>::has_trivial_copy)
            || traits<TYPE>::has_trivial_move)
    {
        memmove(d,s,n*sizeof(TYPE));
    } else {
        while (n--) {
            if (!traits<TYPE>::has_trivial_copy) {
                new(d) TYPE(*s);
            } else {
                *d = *s;
            }
            if (!traits<TYPE>::has_trivial_dtor) {
                s->~TYPE();
            }
            d++, s++;
        }
    }
}
///////////////////////////////////////////////////////////////////////////////

class VectorImpl {
public:
    enum { // flags passed to the ctor
        HAS_TRIVIAL_CTOR    = 0x00000001,
        HAS_TRIVIAL_DTOR    = 0x00000002,
        HAS_TRIVIAL_COPY    = 0x00000004,
    };
    VectorImpl(size_t itemSize, uint32_t flags);
    virtual ~VectorImpl();
    ssize_t         add();
    void*           editArrayImpl();
    void*           editItemLocation(size_t index);
    void            finish_vector();
protected:
    virtual void do_construct(void* storage, size_t num) const = 0;
    virtual void do_destroy(void* storage, size_t num) const = 0;
    virtual void do_copy(void* dest, const void* from, size_t num) const = 0;
    virtual void do_splat(void* dest, const void* item, size_t num) const = 0;
    virtual void do_move_forward(void* dest, const void* from, size_t num) const = 0;
    virtual void do_move_backward(void* dest, const void* from, size_t num) const = 0;
private:
    void *   mStorage;
    size_t   mCount;
    uint32_t mFlags;
    size_t   mItemSize;
};

template <class TYPE> class Vector : private VectorImpl {
public:
    Vector() : VectorImpl(sizeof(TYPE), ((traits<TYPE>::has_trivial_ctor? HAS_TRIVIAL_CTOR: 0)|(traits<TYPE>::has_trivial_dtor ? HAS_TRIVIAL_DTOR : 0)|(traits<TYPE>::has_trivial_copy ? HAS_TRIVIAL_COPY : 0))) {}
    virtual ~Vector() {finish_vector();}
    inline  ssize_t         add() {return VectorImpl::add();}
    inline  TYPE*           editArray() {return static_cast<TYPE *>(editArrayImpl());}
    inline  TYPE&           editItemAt(size_t index) {return *( static_cast<TYPE *>(editItemLocation(index)) );}
protected:
    virtual void do_construct(void* storage, size_t num) const { construct_type( reinterpret_cast<TYPE*>(storage), num ); }
    virtual void do_destroy(void* storage, size_t num) const { destroy_type( reinterpret_cast<TYPE*>(storage), num ); }
    virtual void do_copy(void* dest, const void* from, size_t num) const { copy_type( reinterpret_cast<TYPE*>(dest), reinterpret_cast<const TYPE*>(from), num ); }
    virtual void do_splat(void* dest, const void* item, size_t num) const { splat_type( reinterpret_cast<TYPE*>(dest), reinterpret_cast<const TYPE*>(item), num ); }
    virtual void do_move_forward(void* dest, const void* from, size_t num) const { move_forward_type( reinterpret_cast<TYPE*>(dest), reinterpret_cast<const TYPE*>(from), num ); }
    virtual void do_move_backward(void* dest, const void* from, size_t num) const { move_backward_type( reinterpret_cast<TYPE*>(dest), reinterpret_cast<const TYPE*>(from), num ); }
};

ANDROID_TRIVIAL_MOVE_TRAIT(String16)
ANDROID_TRIVIAL_MOVE_TRAIT(String8)

} //end of namespace android

#endif //end of lib