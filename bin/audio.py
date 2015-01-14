#!/usr/bin/python
# accessory.py
# License GPLv2
# (c) Manuel Di Cerbo, Nexus-Computing GmbH
 
import usb.core
import usb.util
import struct
import time
import threading
import os
import socket
 
MANUFACTURER = "Nexus-Computing GmbH"
MODEL_NAME = "Simple Slider"
DESCRIPTION = "A Simple Slider"
VERSION = "0.1"
URL = "http://www.nexus-computing.ch/SimpleAccessory.apk"
SERIAL_NUMBER = "1337"
 
ADB_VID = 0x18D1
AUDIO_ADB_PID = 0x2D03
 
def main():
    while True:
        print("starting audio+adb task")
        try:
            accessory_task()
            time.sleep(5)
        except ValueError:
            pass
        print("audio+adb task finished")
 
def accessory_task():
    dev = usb.core.find(idVendor=ADB_VID);
    if dev is None:
        raise ValueError("No compatible device not found")
 
    if dev.idProduct == AUDIO_ADB_PID:
        print("device is in audio+adb mode. device: "+str(dev))
    else:
        accessory(dev)
        dev = usb.core.find(idVendor=ADB_VID, idProduct=AUDIO_ADB_PID);
        if dev is None:
            raise ValueError("No audio+adb device not found")
        print("audio+adb device : "+str(dev))
 
    # even if the Android device is already in accessory mode
    # setting the configuration will result in the
    # UsbManager starting an "accessory connected" intent
    # and hence a small delay is required before communication
    # works properly
    time.sleep(1)
 
    cfg = dev.get_active_configuration()
    intf = usb.util.find_descriptor(cfg, bInterfaceNumber = 1, bAlternateSetting=1)
    print("intf: "+str(intf))
 
    ep_in = usb.util.find_descriptor(
        intf,
        custom_match = \
        lambda e: \
            usb.util.endpoint_direction(e.bEndpointAddress) == \
            usb.util.ENDPOINT_IN
    )
    print("Endpoint: "+str(ep_in))
   
    dev.set_interface_altsetting(interface=1, alternate_setting=1)
    # length = -1
    import binascii
    while True:
        try:
            # data = ep_in.read(size = 1, timeout = 0)
            data = ep_in.read(size_or_buffer = 2560, timeout = 5000)
            print("got data "+binascii.hexlify(data) + " type(data)" + str(type(data)))
            # print("read value %d" % data[0])
        except usb.core.USBError as e:
            if e.errno !=60:
                print("read err "+ str(e) + " backend_error_code:"+str(e.backend_error_code))
                break
 
    print("exiting application")
 
def accessory(dev):
    version = dev.ctrl_transfer(
                usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_IN,
                51, 0, 0, 2)
    print("version is: %d" % struct.unpack('<H',version)) 
 
    # assert dev.ctrl_transfer(
    #         usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
    #         52, 0, 0, MANUFACTURER) == len(MANUFACTURER) 
     
    # assert dev.ctrl_transfer(
    #         usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
    #         52, 0, 1, MODEL_NAME) == len(MODEL_NAME) 
          
    assert dev.ctrl_transfer(
            usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
            52, 0, 2, DESCRIPTION) == len(DESCRIPTION) 
 
    assert dev.ctrl_transfer(
            usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
            52, 0, 3, VERSION) == len(VERSION) 
 
    assert dev.ctrl_transfer(
            usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
            52, 0, 4, URL) == len(URL) 
 
    assert dev.ctrl_transfer(
            usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
            52, 0, 5, SERIAL_NUMBER) == len(SERIAL_NUMBER)
     
    #set stereo audio
    assert dev.ctrl_transfer(
            usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
            58, 1, 0, None) == 0
     
    dev.ctrl_transfer(
            usb.util.CTRL_TYPE_VENDOR | usb.util.CTRL_OUT,
            53, 0, 0, None)
 
    time.sleep(1)

if __name__ == "__main__":
    main()
