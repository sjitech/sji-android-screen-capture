#!/bin/sh

printenv NDK_ROOT > /dev/null || { echo please export NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

SYS_ROOT=`ls -d $NDK_ROOT/platforms/android-9/arch-arm | tail -n 1`
TOOL_CHAIN_DIR=`ls -d $NDK_ROOT/toolchains/arm-linux-androideabi-*/prebuilt/* | tail -n 1`
CC="$TOOL_CHAIN_DIR/bin/arm-linux-androideabi-gcc --sysroot=$SYS_ROOT"

CC="$CC -O3"
CC="$CC -fmax-errors=5"

rm -f *.so

TARGET_DIR=../../../bin/android

echo ---------------make dlopen --------------------
$CC dlopen.c -o $TARGET_DIR/dlopen || exit 1

echo ---------------make dlopen \(PosIndependentExe\)--------------------
$CC -pie -fPIE dlopen.c -o $TARGET_DIR/dlopen.pie || exit 1

echo ---------------make dlcall --------------------
$CC dlcall.c -o bin/dlcall || exit 1

echo ---------------make dlcall \(PosIndependentExe\)--------------------
$CC -pie -fPIE dlcall.c -o bin/dlcall.pie || exit 1

echo ""; echo ok; echo ""
