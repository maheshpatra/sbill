import { BadRequestException } from '@nestjs/common';
import { httpsImageUrl, withHttpsSiteImages } from './https-url';

describe('https image urls', () => {
  it('keeps an https URL and clears an empty one', () => {
    expect(httpsImageUrl(' https://cdn.example.com/rice.jpg ', 'image_url')).toBe('https://cdn.example.com/rice.jpg');
    expect(httpsImageUrl('', 'image_url')).toBeNull();
    expect(httpsImageUrl(null, 'image_url')).toBeNull();
    expect(httpsImageUrl(undefined, 'image_url')).toBeUndefined();
  });

  it('rejects a non-https product or site image', () => {
    expect(() => httpsImageUrl('http://cdn.example.com/rice.jpg', 'image_url')).toThrow(BadRequestException);
    expect(() => withHttpsSiteImages({ hero_image_url: 'http://cdn.example.com/hero.jpg' })).toThrow(BadRequestException);
    expect(withHttpsSiteImages({
      title: 'Acme',
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      about_image_url: null,
    })).toEqual({
      title: 'Acme',
      hero_image_url: 'https://cdn.example.com/hero.jpg',
      about_image_url: null,
    });
  });
});
