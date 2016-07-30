#!/bin/sh

ls -d ./std_toolchain > /dev/null || { echo please execute ./0_make_ndk_toolchain.sh first; exit 1; }

export PATH="$PWD/std_toolchain/bin:$PATH"

cd ./ffmpeg_src            || { echo please download ffmpeg source to [./ffmpeg_src];            exit 1; }

echo ---------------patch some files--------------------
cp -fv ../patch_ffmpeg_x11grab.c ./libavdevice/x11grab.c || exit 1
cp -fv ../patch_ffmpeg_configure ./configure || exit 1
#cp -fv ../patch_ffmpeg_ffmpeg.c ./ffmpeg.c || exit 1
echo ""; echo ok; echo ""

echo ---------------config ffmpeg [armv5]--------------------
./configure --enable-cross-compile --cross-prefix=arm-linux-androideabi- --target-os=linux \
    --arch=arm --cpu=armv5te \
    --disable-doc --disable-ffplay --disable-ffprobe --disable-ffserver --disable-symver --disable-debug --disable-everything \
    --enable-static \
	--enable-protocol=pipe \
	--enable-filter=scale --enable-filter=crop --enable-filter=transpose \
	--enable-demuxer=rawvideo --enable-decoder=rawvideo \
	--enable-muxer=image2 --enable-muxer=image2pipe --enable-muxer=mjpeg --enable-encoder=mjpeg --enable-encoder=png \
	--enable-x11grab --enable-indev=x11grab \
	|| exit 1

echo ---------------make ffmpeg [armv5]--------------------
make clean
make all || exit 1

cp -fv ./ffmpeg ../../../../bin/android/ffmpeg.armv5 || exit 1

echo ""; echo ok; echo ""