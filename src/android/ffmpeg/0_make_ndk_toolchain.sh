#!/bin/sh

echo ---------------make standard GCC Tool Chain from Android NDK--------------------
ls -d ./std_toolchain && { echo ./std_toolchain already exist; exit 0; }

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

PLATFORM=`cd $ANDROID_NDK_ROOT/platforms && ls -d android-?? | tail -n 1`
TOOLCHAIN=`cd $ANDROID_NDK_ROOT/toolchains && ls -d arm-linux-androideabi-* | tail -n 1`
$ANDROID_NDK_ROOT/build/tools/make-standalone-toolchain.sh --install-dir=./std_toolchain --platform=$PLATFORM --toolchain=$TOOLCHAIN --ndk-dir=$ANDROID_NDK_ROOT --arch=arm --verbose

echo ""; echo ok; echo ""
