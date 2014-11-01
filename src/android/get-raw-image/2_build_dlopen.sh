#!/bin/sh

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }


SYS_ROOT=`ls -d $ANDROID_NDK_ROOT/platforms/android-*/arch-arm | tail -n 1` || exit 1
TOOL_CHAIN_DIR=`ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-[4-5].*/prebuilt/* | tail -n 1` || exit 1
CC="$TOOL_CHAIN_DIR/bin/arm-linux-androideabi-gcc --sysroot=$SYS_ROOT"

CC="$CC -O3"
CC="$CC -fmax-errors=5"

rm -f *.so

TARGET_DIR=../../../bin/android

echo ---------------make dlopen --------------------
$CC dlopen.c -o $TARGET_DIR/dlopen || exit 1

echo ""; echo ok; echo ""
