#if !defined(HFILE_libutils_stl) && ANDROID_VER>=400
#define HFILE_libutils_stl

#include "libutils.h"
#include <new>

namespace android {

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
    inline  size_t  size() const { return mCount; }
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
    inline  size_t          size() const {return VectorImpl::size();}
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