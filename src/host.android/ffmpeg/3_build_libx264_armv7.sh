#!/bin/sh

ls -d ./std_toolchain > /dev/null || { echo please execute ./0_make_ndk_toolchain.sh first; exit 1; }

export PATH="$PWD/std_toolchain/bin:$PATH"
export CC=arm-linux-androideabi-gcc

cd ./ffmpeg_src/libx264_src || { echo please download libx264 source to [./ffmpeg_src/libx264_src]; exit 1; }

echo ---------------config libx264 [armv7]--------------------
./configure --host=armv7-linux-androideabi --cross-prefix=arm-linux-androideabi- --enable-static --disable-cli --enable-pic --prefix=./qj_armv7 \
	|| exit 1

echo ---------------make libx264 [armv7]--------------------
make clean
make all || exit 1
make install || exit 1

echo ""; echo ok; echo ""