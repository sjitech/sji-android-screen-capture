#!/bin/sh

printenv ANDROID_NDK_ROOT > /dev/null || { echo please export ANDROID_NDK_ROOT=root_dir_of_your_android_ndk; exit 1; }

SYS_ROOT=`ls -d $ANDROID_NDK_ROOT/platforms/android-8/arch-arm` || exit 1
TOOL_CHAIN_DIR=`ls -d $ANDROID_NDK_ROOT/toolchains/arm-linux-androideabi-[4-5].*/prebuilt/* | tail -n 1` || exit 1
CC="$TOOL_CHAIN_DIR/bin/arm-linux-androideabi-g++ --sysroot=$SYS_ROOT"

#STL_ROOT=`ls -d $ANDROID_NDK_ROOT/sources/cxx-stl/gnu-libstdc++/[4-5].* | tail -n 1` || exit 1
#CC="$CC -I$STL_ROOT/include -I $STL_ROOT/libs/armeabi/include"

CC="$CC -O3"
CC="$CC -fmax-errors=5"
CC="$CC -fno-rtti -fno-exceptions"

mkdir bin 2>/dev/null
rm -f *.so

TARGET_DIR=../../../bin/android
MAKE_TRIAL=0

for v in 420 430 440 500; do
    echo ""
    echo ---------------android $v --------------------
	for f in libgui libbinder libutils libcutils libui; do
		echo ---------------make $f.so --------------------
		$CC -DANDROID_VER=$v -fPIC -shared $f.cpp -o $f.so || exit 1
	done

	echo ---------------make fsc-$v test launcher --------------------
	$CC -DANDROID_VER=$v -DMAKE_TEST=1 fast-screen-capture.cpp *.so -o bin/fsc-$v -Xlinker -rpath=/system/lib || exit 1

	echo ---------------make fsc-$v test launcher \(PosIndependentExe\)--------------------
	$CC -DANDROID_VER=$v -DMAKE_TEST=1 -pie -fPIE fast-screen-capture.cpp *.so -o bin/fsc-$v.pie -Xlinker -rpath=/system/lib || exit 1

	rm -f *.so
done

echo ""; echo ok; echo ""
