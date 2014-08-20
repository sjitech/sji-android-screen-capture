sji-android-screen-capture
==========================

No-Root-Needed Android Fast Screen Capture & Caster & Recorder & Remote Controller From PC's Browser
This project is aimed to provide a fast way to capture android screen and live view,share,record,remote control it from PC's HTML5 browser.
No Root Required: You need NOT root your android device)
It's real time (can encode 4+ frames/second for 1920x1080 screen. If shrink size to 320xauto image, can encode at 8+ frames/second). And it's low bandwidth usage (typically 150,000 bytes/second). This product will do encoding in host and android by ffmpeg. Support Chrome, Firefox, Safari. Windows/Mac/Linux/Unix

New: Recorded file can be auto converted to H.264/MP4 and WebM video format if you'v installed ffmpeg in local PC.
New: Support Remote Control by mouse click/move/drag on live view UI. (Tested on Android 2.2~4.4)

<b>
New: We will enhance performance to 30 frames/second full screen in about 2 months, for android 4.2~4.4.  No root needed, just use adb.</b>

<b>For private reason, we'v closed this project, if you are interested with this project or asking for bussiness support please contact osexp2003@gmail.com, Feel free to feedback with English/日本語/中国語!</b>

<br><br>

[Screenshot]

Menu<br>
<img src="doc/screenshot-menu.png" /><br>
Live View<br>
<img src="doc/liveview.png" /><br>
Recorded Videos<br>
<img src="doc/recorded.png" /><br>

[How to use]

1.<b>Setup PC Environment (Windows/Mac/Linux/Unix)</b>
<pre><code><a href="http://developer.android.com/sdk/index.html">Install Android SDK</a> (at least "Platform Tools" which include adb(Android Debug Bridge)).
<a href="http://nodejs.org/download/">install node.js</a>.
Install android USB driver automatically or manually when you first plug Android into PC.
If you want to always record as H.264/MP4 or WebM video format, you need <a href="http://www.ffmpeg.org/download.html">install FFMPEG into PC</a>.
</code></pre>
To simplify other settings, you'd better put the directory of adb and local ffmpeg into PATH environment variable otherwise you need put the fullpath of them into "adb" and "ffmpeg" settings in stream.json file.
<br><br>
2.<b>Start Android Screen Capture (include a video stream server) on PC</b>
<pre><code>
node dir_of_this_project/bin/stream.js
</code></pre>
You can edit configuration file <a href="https://raw.github.com/sjitech/sji-android-screen-capture/master/bin/stream.json">stream.json</a> to change IP, port, SSL...
<br><br>
Or you can specify your own configuration file which can be copied from config.json file in this dir.
<pre><code>
node dir_of_this_project/bin/stream.js dir_of_your_config/myConfig.json
</code></pre>
3.<b>Show video/animated image of android from PC by browsing <a href="http://localhost:3000/">http://localhost:3000/</a></b>  <br>
Support <a href="http://www.webmproject.org/">WebM</a> video and <a href="http://en.wikipedia.org/wiki/H.264/MPEG-4_AVC">H.264/MP4</a> and Animated JPEG/PNG by <a href="http://en.wikipedia.org/wiki/MIME#Mixed-Replace">Multi-Part HTTP Response</a>.
Chrome,Firefox,Safari are well supported. IE10+ is not tested but should be OK.
<br><br>

===================
[Note]
    Currently tested in android 2.2~4.4.  With PC Browser Chrome 33, Firefox 27, Safari 7.
    Host OS can be Windows/Mac/Linux (Unix should also be OK, but not tested).
    Build: src/build_all.sh has been tested in Mac OS X 10.7 64bit and Ubuntu 12 64bit,
    Android NDK r8 or r9. Gcc 4.4.3 or 4.8.
    bin/android/busybox is downloaded from <a href="http://www.busybox.net/downloads/binaries/latest/busybox-armv5l">busybox binary downloads</a>.
    <br>
    Currently this product need PC, but can be modified to run in rooted android device directly, if you are interested please contact me.
