#!/bin/sh

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }


TOOL_CHAIN_DIR=`ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-4.*/prebuilt/* | tail -n 1` || exit 1
LIBGCC_DIR=`ls -d $TOOL_CHAIN_DIR/lib/gcc/arm-linux-androideabi/4.* | tail -n 1` || exit 1
LIBEXEC_DIR=`ls -d $TOOL_CHAIN_DIR/libexec/gcc/arm-linux-androideabi/4.* | tail -n 1` || exit 1
SYS_ROOT="$ANDROID_NDK_ROOT/platforms/android-8/arch-arm"
CPP_ROOT=`ls -d $ANDROID_NDK_ROOT/sources/cxx-stl/gnu-libstdc++/4.* | tail -n 1` || exit 1
MAKE_DIR=`ls -d $ANDROID_NDK_ROOT/prebuilt/*/bin | tail -n 1` || exit 1
export  CFLAGS="-O3 --sysroot=$SYS_ROOT -I$SYS_ROOT/usr/include -I$LIBGCC_DIR/include -I$CPP_ROOT/include"
export LDFLAGS="-B$SYS_ROOT/usr/lib -B$LIBGCC_DIR -B$TOOL_CHAIN_DIR/arm-linux-androideabi/bin -B$LIBEXEC_DIR -B$CPP_ROOT/libs/armeabi"
export PATH="$TOOL_CHAIN_DIR/arm-linux-androideabi/bin:$LIBEXEC_DIR:$MAKE_DIR:$PATH"

echo ---------------make get-raw-image--------------------

gcc -x c -std=c99 $CFLAGS $LDFLAGS get-raw-image.cpp      -o ../bin/android/get-raw-image-old   -Xlinker -rpath=/system/lib || exit 1

g++ $CFLAGS $LDFLAGS fake_libgui.cpp                      -o libgui.so                          -fPIC -shared || exit 1
g++ $CFLAGS $LDFLAGS get-raw-image.cpp -lsupc++ libgui.so -o ../bin/android/get-raw-image-4.1.2 -Xlinker -rpath=/system/lib -DTARGET_JB || exit 1
g++ $CFLAGS $LDFLAGS get-raw-image.cpp -lsupc++ libgui.so -o ../bin/android/get-raw-image-4     -Xlinker -rpath=/system/lib -DTARGET_ICS || exit 1

rm libgui.so

echo ""; echo ok; echo ""
