import argparse
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gui_references import ReferenceError, locate, train, validate
from youtube_gui_uploader import run, upload, video_url


class ReferencesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = self.tmp.name
        self.patch = np.random.default_rng(22).integers(30, 240, (30, 80, 3), dtype=np.uint8)
        self.screen = Image.new('RGB', (640, 480), '#eeeeee')
        self.screen.paste(Image.fromarray(self.patch), (100, 80))
        train(self.root, 'next', self.screen, (100, 80, 80, 30), (640, 480))

    def test_locates_moved_control(self):
        moved = Image.new('RGB', (640, 480), '#eeeeee')
        moved.paste(Image.fromarray(self.patch), (420, 350))
        found = locate(self.root, 'next', moved, (640, 480))
        self.assertEqual(found['point'], [460, 365])

    def test_retina_coordinates(self):
        retina = self.screen.resize((1280, 960), Image.Resampling.NEAREST)
        found = locate(self.root, 'next', retina, (640, 480))
        self.assertEqual(found['point'], [140, 95])

    def test_missing_control(self):
        self.assertIsNone(locate(self.root, 'next', Image.new('RGB',(640,480),'white'), (640,480)))

    def test_duplicate_rejected(self):
        self.screen.paste(Image.fromarray(self.patch), (350, 200))
        with self.assertRaisesRegex(ReferenceError, 'Ambiguous'):
            locate(self.root, 'next', self.screen, (640, 480))

    def test_region_resolves_duplicate(self):
        train(self.root, 'next', self.screen, (100,80,80,30), (640,480), region=[0,0,.5,.5])
        self.screen.paste(Image.fromarray(self.patch),(400,350))
        self.assertIsNotNone(locate(self.root,'next',self.screen,(640,480)))

    def test_blank_and_out_of_bounds_rejected(self):
        for box in [(1,1,20,20), (-2,1,20,20), (600,400,80,90)]:
            with self.assertRaises(ReferenceError):
                train(self.root,'bad',self.screen,box,(640,480))

    def test_tampered_reference_rejected(self):
        Image.new('RGB',(80,30),'black').save(Path(self.root)/'next.png')
        with self.assertRaisesRegex(ReferenceError,'changed'):
            locate(self.root,'next',self.screen,(640,480))

    def test_incomplete_profile_rejected(self):
        with self.assertRaisesRegex(ReferenceError,'Missing trained'):
            validate(self.root)


class FakeDriver:
    def __init__(self, directory='', audit=None, fail=None):
        self.calls=[]
        self.fail=fail
    def action(self,name,*args):
        self.calls.append((name,*args))
        if self.fail in args and self.fail is not None: raise RuntimeError('missing '+self.fail)
    def open_channel(self,*args): self.action('open_channel',*args)
    def click(self,*args): self.action('click',*args)
    def choose_file(self,*args): self.action('choose_file',*args)
    def wait(self,*args): self.action('wait',*args)
    def text(self,*args): self.action('text',*args)
    def reveal(self,*args): self.action('reveal',*args)
    def copy_link(self): return 'https://youtu.be/X-FMCmi8wkU'


class UploadTest(unittest.TestCase):
    def test_success_requires_saved_confirmation(self):
        driver=FakeDriver()
        result=upload(driver,'file.mp4','Title','Description','', 'UC'+'a'*22,lambda *a:None)
        self.assertEqual(result['privacyStatus'],'private')
        self.assertLess(driver.calls.index(('wait','checks_complete',900)), driver.calls.index(('click','save',900)))
        self.assertLess(driver.calls.index(('wait','private_selected')),driver.calls.index(('click','save',900)))
        self.assertIn(('wait','upload_complete',900),driver.calls)

    def test_missing_check_or_private_control_never_saves(self):
        for fail in ['checks_complete','private_selected','audience_no_selected']:
            driver=FakeDriver(fail=fail)
            with self.assertRaises(RuntimeError):
                upload(driver,'file.mp4','Title','','','UC'+'a'*22,lambda *a:None)
            self.assertNotIn(('click','save',900),driver.calls)

    def test_bad_url_rejected(self):
        for url in ['https://example.com/watch?v=X-FMCmi8wkU','', 'file.mp4']:
            with self.assertRaises(RuntimeError): video_url(url)

    @patch('youtube_gui_uploader.validate')
    def test_receipt_prevents_duplicate_after_success(self,_):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'test.mp4'; path.write_bytes(b'fixture-video')
            args=argparse.Namespace(video_path=str(path), title='Title',description='',tags='',channel_id='UC'+'a'*22,
                                    privacy='private',references=folder,runs=folder,timeout=1)
            first=run(args,FakeDriver)
            second=run(args,lambda *a: self.fail('duplicate upload'))
            self.assertEqual(first,second)

    @patch('youtube_gui_uploader.validate')
    def test_uncertain_attempt_requires_review(self,_):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'test.mp4'; path.write_bytes(b'fixture-video')
            args=argparse.Namespace(video_path=str(path), title='Title',description='',tags='',channel_id='UC'+'a'*22,
                                    privacy='private',references=folder,runs=folder,timeout=1)
            with self.assertRaisesRegex(RuntimeError,'missing'):
                run(args,lambda *a:FakeDriver(fail='upload_complete'))
            with self.assertRaisesRegex(RuntimeError,'earlier attempt'):
                run(args,lambda *a:self.fail('duplicate upload'))
            receipt=list(Path(folder).glob('UC*.json'))[0]
            self.assertEqual(json.loads(receipt.read_text())['status'],'needs_review')


if __name__=='__main__': unittest.main()
