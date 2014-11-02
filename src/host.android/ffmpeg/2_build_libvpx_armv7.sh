#!/bin/sh

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

cd ./ffmpeg_src/libvpx_src || { echo please download libvpx source to [./ffmpeg_src/libvpx_src]; exit 1; }

echo ---------------config libvpx [armv7]--------------------
./configure --target=armv7-android-gcc --disable-examples --disable-docs --enable-static --enable-pic --disable-realtime-only \
	--sdk-path=$ANDROID_NDK_ROOT --prefix=./qj_armv7 \
	|| exit 1

echo ---------------make libvpx [armv7]--------------------
make clean
make all || exit 1
make install || exit 1

echo ""; echo ok; echo ""