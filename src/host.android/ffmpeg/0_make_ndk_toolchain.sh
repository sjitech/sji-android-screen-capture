#!/bin/sh

echo ---------------make standard GCC Tool Chain from Android NDK--------------------
ls -d ./std_toolchain && { echo ./std_toolchain already exist; exit 0; }

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

PLATFORM=$(basename $(ls -d $ANDROID_NDK_ROOT/platforms/android-8)); test -z $PLATFORM && exit 1
TOOLCHAIN=$(basename $(ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-[4-5].* | tail -n 1)); test -z $TOOLCHAIN && exit 1
WORK_SYSTEM=$(basename $(ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-[4-5].*/prebuilt/* | tail -n 1)); test -z $WORK_SYSTEM && exit 1
$ANDROID_NDK_ROOT/build/tools/make-standalone-toolchain.sh --install-dir=./std_toolchain --platform=$PLATFORM --toolchain=$TOOLCHAIN --system=$WORK_SYSTEM --arch=arm --verbose

echo ""; echo ok; echo ""
