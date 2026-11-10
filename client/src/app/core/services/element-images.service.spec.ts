import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ApiClientService } from './api-client.service';
import { ElementImagesService } from './element-images.service';

describe('ElementImagesService.stillDataUrl', () => {
   beforeAll(() => {
      URL.createObjectURL ??= () => 'blob:test';
   });

   function setup() {
      const http = { get: jest.fn(() => of(new Blob(['png-bytes'], { type: 'image/png' }))) };
      TestBed.configureTestingModule({
         providers: [
            { provide: HttpClient, useValue: http },
            { provide: ApiClientService, useValue: {} },
         ],
      });
      return { http, images: TestBed.inject(ElementImagesService) };
   }

   it('encodes each file once and reuses the data URL afterwards (P1.12)', async () => {
      const { http, images } = setup();
      const read = jest.spyOn(FileReader.prototype, 'readAsDataURL');

      const first = await images.stillDataUrl('f1');
      const again = await Promise.all([images.stillDataUrl('f1'), images.stillDataUrl('f1')]);

      expect(first).toMatch(/^data:image\/png;base64,/);
      expect(again).toEqual([first, first]);
      expect(read).toHaveBeenCalledTimes(1);
      expect(http.get).toHaveBeenCalledTimes(1);
      read.mockRestore();
   });
});
